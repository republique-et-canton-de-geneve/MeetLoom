import type { Express } from "express";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import type { Session } from "../shared/model.js";
import { allBlocks } from "../shared/domain.js";
import { extractTasks, extractMaterials } from "../shared/richtext.js";
import { accountProfile } from "./accounts.js";
import { hashToken, rateLimit, token } from "./security.js";
import { getSessionLifecycle } from "./lifecycle.js";
import { log } from "./log.js";

/** The SMTP error codes (connection, authentication, rejection), never the
 * message or its recipients. */
const smtpFailure = (error: unknown) => {
  const value = error as { code?: unknown; responseCode?: unknown };
  return {
    code: typeof value?.code === "string" ? value.code : "unknown",
    responseCode:
      typeof value?.responseCode === "number" ? value.responseCode : null,
  };
};

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  scheduled: boolean;
}
export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
  close?(): void;
}
function createMailTransport(config: MailConfig): MailTransport {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: config.user
      ? { user: config.user, pass: config.password ?? "" }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return {
    async send(message) {
      await transport.sendMail({
        ...message,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    },
    close() {
      transport.close();
    },
  };
}
type Recipient = { id: string; email: string; name: string; locale: string };
type Dependencies = {
  db: Database;
  config?: MailConfig;
  origin?: string;
  transport?: MailTransport;
  rateLimits?: boolean;
};
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const short = (value: string, max = 160) =>
  value.replace(/[\r\n]+/g, " ").slice(0, max);
const currentRecipient = (sql: Sql, userId: string) =>
  sql.all<Recipient>(
    "SELECT id,email,name,locale FROM users WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
    [userId],
  );

export async function installMailApi(
  app: Express,
  { db, config, origin, transport: provided, rateLimits }: Dependencies,
) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS mail_deliveries (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL,lease_until BIGINT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL)",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS mail_digest_state (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,until_ms BIGINT NOT NULL)",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS mail_recovery_requests (email_hash TEXT PRIMARY KEY,requested_at BIGINT NOT NULL)",
  );
  if (config && !origin)
    throw new Error("APP_ORIGIN is required when SMTP is enabled.");
  const transport = config
      ? (provided ?? createMailTransport(config))
      : undefined,
    pending = new Set<Promise<void>>();
  let running = false,
    closing = false;
  const background = (job: () => Promise<void>) => {
    if (closing || pending.size >= 100) return false;
    const work = job()
      .catch((error: unknown) => {
        log.warn("SMTP delivery failed", smtpFailure(error));
      })
      .finally(() => pending.delete(work));
    pending.add(work);
    return true;
  };
  const send = async (recipient: Recipient, subject: string, text: string) => {
    if (!config || !transport) throw new Error("Mail disabled");
    await transport.send({
      from: config.from,
      to: recipient.email,
      subject: short(subject),
      text,
    });
  };
  app.post(
    "/api/auth/forgot-password",
    ...(rateLimits === false ? [] : [rateLimit(10, 15 * 60 * 1000)]),
    async (request, response) => {
      const input = z
          .object({
            email: z
              .email()
              .max(254)
              .transform((value) => value.toLowerCase().trim()),
          })
          .strict()
          .parse(request.body),
        started = Date.now();
      if (config && transport && !closing) {
        // The same durable per-address cooldown is used for existing and unknown
        // addresses. Responses never expose whether an account or SMTP delivery exists.
        const recipient = await db.transaction(async (sql) => {
          const emailHash = hashToken(input.email);
          await sql.run(
            "DELETE FROM mail_recovery_requests WHERE requested_at<$1",
            [Date.now() - day],
          );
          await sql.run(
            "INSERT INTO mail_recovery_requests(email_hash,requested_at) VALUES($1,0) ON CONFLICT(email_hash) DO NOTHING",
            [emailHash],
          );
          const claimed = await sql.run(
            "UPDATE mail_recovery_requests SET requested_at=$1 WHERE email_hash=$2 AND requested_at<=$3",
            [Date.now(), emailHash, Date.now() - 15 * 60 * 1000],
          );
          if (!claimed) return;
          const [user] = await sql.all<Recipient>(
            "SELECT id,email,name,locale FROM users WHERE email=$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
            [input.email],
          );
          return user;
        });
        if (recipient) {
          const raw = token(),
            hash = hashToken(raw);
          await db.run("DELETE FROM account_resets WHERE expires_at<=$1", [
            Date.now(),
          ]);
          await db.run(
            "INSERT INTO account_resets(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
            [hash, recipient.id, Date.now() + hour],
          );
          const accepted = background(async () => {
            try {
              const [active] = await currentRecipient(db, recipient.id);
              if (!active || active.email !== recipient.email)
                throw new Error("Recipient unavailable");
              const french = recipient.locale === "fr";
              await send(
                recipient,
                french
                  ? "MeetLoom — réinitialiser votre mot de passe"
                  : "MeetLoom — reset your password",
                `${french ? "Utilisez ce lien dans l’heure pour choisir un nouveau mot de passe :" : "Use this link within one hour to choose a new password:"}\n\n${origin}/recover/${raw}\n\n${french ? "Si vous n’avez pas demandé ce message, ignorez-le." : "If you did not request this message, you can ignore it."}`,
              );
            } catch (error) {
              await db.run("DELETE FROM account_resets WHERE token_hash=$1", [
                hash,
              ]);
              throw error;
            }
          });
          if (!accepted)
            await db.run("DELETE FROM account_resets WHERE token_hash=$1", [
              hash,
            ]);
        }
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 350 - (Date.now() - started))),
      );
      response.status(202).json({ ok: true });
    },
  );
  async function deliver(
    key: string,
    recipient: Recipient,
    now: number,
    build: () => Promise<{ subject: string; text: string } | undefined>,
    commit?: (sql: Sql) => Promise<void>,
  ) {
    await db.run(
      "INSERT INTO mail_deliveries(id,user_id,status,lease_until,created_at) VALUES($1,$2,$3,0,$4) ON CONFLICT(id) DO NOTHING",
      [key, recipient.id, "pending", now],
    );
    if (
      !(await db.run(
        "UPDATE mail_deliveries SET status='sending',lease_until=$1,attempts=attempts+1 WHERE id=$2 AND status<>'sent' AND lease_until<=$3 AND attempts<3",
        [now + 60000, key, now],
      ))
    )
      return;
    try {
      const [active] = await currentRecipient(db, recipient.id);
      if (!active || active.email !== recipient.email)
        throw new Error("Recipient unavailable");
      const message = await build();
      if (message) await send(active, message.subject, message.text);
      await db.transaction(async (sql) => {
        await sql.run(
          "UPDATE mail_deliveries SET status='sent',lease_until=0 WHERE id=$1",
          [key],
        );
        if (commit) await commit(sql);
      });
    } catch (error) {
      await db.run(
        "UPDATE mail_deliveries SET status='failed',lease_until=$1 WHERE id=$2",
        [now + 5 * 60 * 1000, key],
      );
      log.warn("Scheduled SMTP delivery failed", smtpFailure(error));
    }
  }
  async function scheduled(now = Date.now()) {
    if (!config || !transport || running || closing) return;
    running = true;
    try {
      await db.run("DELETE FROM mail_deliveries WHERE created_at<$1", [
        now - 30 * day,
      ]);
      const recipients = await db.all<Recipient>(
        "SELECT u.id,u.email,u.name,u.locale FROM users u JOIN account_profiles p ON p.user_id=u.id WHERE NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=u.id) ORDER BY u.id LIMIT 10000",
      );
      for (const recipient of recipients) {
        if (closing) break;
        const profile = await accountProfile(db, recipient.id),
          french = recipient.locale === "fr",
          until = Math.floor(now / hour) * hour;
        if (profile.preferences.emailDigest) {
          const [state] = await db.all<{ until_ms: number | string }>(
              "SELECT until_ms FROM mail_digest_state WHERE user_id=$1",
              [recipient.id],
            ),
            since = state
              ? Math.max(Number(state.until_ms), now - 7 * day)
              : until - hour;
          if (since < until)
            await deliver(
              `digest:${recipient.id}:${until}`,
              recipient,
              now,
              async () => {
                if (
                  !(await accountProfile(db, recipient.id)).preferences
                    .emailDigest
                )
                  return;
                const rows = await db.all<{
                  sessionId: string;
                  count: string | number;
                }>(
                  `SELECT n.session_id AS "sessionId",COUNT(*) AS count FROM notifications n JOIN sessions s ON s.id=n.session_id LEFT JOIN members m ON m.session_id=s.id AND m.user_id=$1 LEFT JOIN session_workspaces sw ON sw.session_id=s.id LEFT JOIN workspace_members wm ON wm.workspace_id=sw.workspace_id AND wm.user_id=$1 WHERE n.user_id=$1 AND NOT EXISTS(SELECT 1 FROM session_lifecycle l WHERE l.session_id=s.id AND l.deleted_at IS NOT NULL) AND n.read_at IS NULL AND n.created_at>=$2 AND n.created_at<$3 AND (s.owner_id=$1 OR m.user_id=$1 OR wm.user_id=$1) GROUP BY n.session_id ORDER BY n.session_id LIMIT 100`,
                  [
                    recipient.id,
                    new Date(since).toISOString(),
                    new Date(until).toISOString(),
                  ],
                );
                if (!rows.length) return;
                const lines: string[] = [];
                for (const row of rows) {
                  const [agenda] = await db.all<{ payload: string }>(
                    "SELECT payload FROM sessions WHERE id=$1",
                    [row.sessionId],
                  );
                  if (agenda)
                    lines.push(
                      `${short((JSON.parse(agenda.payload) as Session).title)} — ${row.count} ${french ? "nouveau(x) échange(s)" : "new update(s)"}\n${origin}/session/${row.sessionId}`,
                    );
                }
                return {
                  subject: french
                    ? "MeetLoom — nouvelles discussions"
                    : "MeetLoom — new discussions",
                  text:
                    lines.join("\n\n") +
                    `\n\n${french ? "Préférences de notification dans votre profil :" : "Notification preferences are available in your profile:"} ${origin}/`,
                };
              },
              async (sql) => {
                await sql.run(
                  "INSERT INTO mail_digest_state(user_id,until_ms) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET until_ms=excluded.until_ms",
                  [recipient.id, until],
                );
              },
            );
        }
        if (profile.preferences.emailReminder) {
          const sessions = await db.all<{ payload: string }>(
            "SELECT s.payload FROM sessions s LEFT JOIN members m ON m.session_id=s.id AND m.user_id=$1 LEFT JOIN session_workspaces sw ON sw.session_id=s.id LEFT JOIN workspace_members wm ON wm.workspace_id=sw.workspace_id AND wm.user_id=$1 WHERE s.owner_id=$1 OR m.role='editor' OR wm.role IN ('admin','editor')",
            [recipient.id],
          );
          for (const row of sessions) {
            const session = JSON.parse(row.payload) as Session;
            if (session.archived) continue;
            const lifecycle = await getSessionLifecycle(db, session.id);
            if (lifecycle?.closed_at || lifecycle?.deleted_at) continue;
            const firstDate = session.days
              .map((day) => day.date)
              .filter(Boolean)
              .sort()[0];
            if (!firstDate) continue;
            const parts = Object.fromEntries(
              new Intl.DateTimeFormat("en-CA", {
                timeZone: session.timezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })
                .formatToParts(now)
                .map((part) => [part.type, part.value]),
            );
            const target = new Date(
              Date.parse(
                `${parts.year}-${parts.month}-${parts.day}T00:00:00Z`,
              ) +
                3 * day,
            )
              .toISOString()
              .slice(0, 10);
            if (firstDate !== target) continue;
            await deliver(
              `reminder:${recipient.id}:${session.id}:${firstDate}`,
              recipient,
              now,
              async () => {
                if (
                  !(await accountProfile(db, recipient.id)).preferences
                    .emailReminder
                )
                  return;
                const [fresh] = await db.all<{ payload: string }>(
                  "SELECT s.payload FROM sessions s LEFT JOIN members m ON m.session_id=s.id AND m.user_id=$1 LEFT JOIN session_workspaces sw ON sw.session_id=s.id LEFT JOIN workspace_members wm ON wm.workspace_id=sw.workspace_id AND wm.user_id=$1 WHERE s.id=$2 AND (s.owner_id=$1 OR m.role='editor' OR wm.role IN ('admin','editor'))",
                  [recipient.id, session.id],
                );
                if (!fresh) return;
                const agenda = JSON.parse(fresh.payload) as Session;
                const currentLifecycle = await getSessionLifecycle(
                  db,
                  agenda.id,
                );
                if (currentLifecycle?.closed_at || currentLifecycle?.deleted_at)
                  return;
                if (
                  agenda.archived ||
                  agenda.days
                    .map((day) => day.date)
                    .filter(Boolean)
                    .sort()[0] !== firstDate
                )
                  return;
                const blocks = agenda.days.flatMap((day) =>
                    allBlocks(day.blocks),
                  ),
                  tasks = blocks
                    .flatMap((block) =>
                      [
                        block.description,
                        ...Object.values(block.fields),
                      ].flatMap(extractTasks),
                    )
                    .filter((task) => !task.checked)
                    .slice(0, 30),
                  materialIds = new Set(
                    agenda.columns
                      .filter((column) => column.kind === "materials")
                      .map((column) => column.id),
                  ),
                  materials = [
                    ...new Set(
                      blocks.flatMap((block) =>
                        Object.entries(block.fields)
                          .filter(([id]) => materialIds.has(id))
                          .flatMap(([, value]) => extractMaterials(value)),
                      ),
                    ),
                  ].slice(0, 30);
                const [{ count }] = await db.all<{ count: string | number }>(
                  "SELECT COUNT(*) AS count FROM comment_threads WHERE session_id=$1 AND resolved_at IS NULL",
                  [agenda.id],
                );
                return {
                  subject: `MeetLoom — ${french ? "dans trois jours" : "in three days"} : ${short(agenda.title, 100)}`,
                  text: `${short(agenda.title)}\n${firstDate} (${agenda.timezone})\n${origin}/session/${agenda.id}\n\n${french ? "Tâches à terminer" : "Outstanding tasks"}\n${tasks.map((task) => `- ${short(task.text, 300)}`).join("\n") || "—"}\n\n${french ? "Matériel" : "Materials"}\n${materials.map((value) => `- ${short(value, 300)}`).join("\n") || "—"}\n\n${count} ${french ? "discussion(s) non résolue(s)" : "unresolved thread(s)"}\n\n${french ? "Désactivez ces rappels dans votre profil :" : "Turn off these reminders in your profile:"} ${origin}/`,
                };
              },
            );
          }
        }
      }
    } finally {
      running = false;
    }
  }
  const interval = config?.scheduled
    ? setInterval(() => background(() => scheduled()), 60000)
    : undefined;
  interval?.unref();
  return {
    enabled: !!config,
    scheduled,
    async flush() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    async close() {
      closing = true;
      if (interval) clearInterval(interval);
      while (pending.size) await Promise.allSettled([...pending]);
      transport?.close?.();
    },
  };
}
