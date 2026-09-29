import type { Express } from "express";
import { randomUUID } from "node:crypto";
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
import { sessionCollaborators } from "./collaborators.js";

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

export type InvitationMail = (invite: {
  email: string;
  /** The inviter's language, for someone without an account yet. */
  locale: "fr" | "en";
  inviter: string;
  inviterId: string;
  /** What the invitation is for (a session or workspace id, or "account"):
   * the same person is emailed about it at most every 15 minutes. */
  target: string;
  kind: "session" | "workspace" | "account";
  /** The session or workspace name. */
  title?: string;
  /** Absolute path in the application, such as /join/<token>. */
  path: string;
  /** Already has an account: no link to accept. */
  existing?: boolean;
}) => Promise<boolean>;
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
  await db.run(
    "CREATE TABLE IF NOT EXISTS mail_invitation_log (key TEXT PRIMARY KEY,sender TEXT NOT NULL,sent_at BIGINT NOT NULL)",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS mail_outbox (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,email TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,lease_until BIGINT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL)",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS mail_outbox_scope (id TEXT PRIMARY KEY REFERENCES mail_outbox(id) ON DELETE CASCADE,purpose TEXT NOT NULL,target TEXT)",
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
  /**
   * An invitation, emailed to the person invited: the private link to join
   * for someone without an account, the place to find it otherwise. Sent
   * before the request answers, so "emailed" is true only once the SMTP
   * server accepted it; the join link is never stored, and the inviter keeps
   * it to pass on otherwise. Being added again with an account emails the
   * same person about the same thing at most every 15 minutes; a new join
   * link always goes out, since it replaces the previous one. One person
   * sends at most 50 invitation emails an hour.
   */
  const invitation: InvitationMail = async (invite) => {
    if (!config || !transport || closing) return false;
    // Being added again shares one row per person and target, for the
    // cooldown; each new link is a row of its own, so the hourly cap counts
    // every email sent.
    const now = Date.now(),
      key = invite.existing
        ? hashToken(`${invite.email}\n${invite.kind}\n${invite.target}`)
        : randomUUID();
    const claimed = await db.transaction(async (sql) => {
      // The sender's row serializes their invitations across pods, so the
      // hourly count below cannot be outrun by simultaneous requests.
      await sql.run("UPDATE users SET id=id WHERE id=$1", [invite.inviterId]);
      await sql.run("DELETE FROM mail_invitation_log WHERE sent_at<$1", [
        now - day,
      ]);
      const [{ count }] = await sql.all<{ count: string | number }>(
        "SELECT COUNT(*) AS count FROM mail_invitation_log WHERE sender=$1 AND sent_at>$2",
        [invite.inviterId, now - hour],
      );
      if (Number(count) >= 50) return false;
      await sql.run(
        "INSERT INTO mail_invitation_log(key,sender,sent_at) VALUES($1,$2,0) ON CONFLICT(key) DO NOTHING",
        [key, invite.inviterId],
      );
      return !!(await sql.run(
        "UPDATE mail_invitation_log SET sender=$1,sent_at=$2 WHERE key=$3 AND sent_at<=$4",
        [invite.inviterId, now, key, now - 15 * 60 * 1000],
      ));
    });
    if (!claimed) return false;
    // Someone with an account reads it in their own language.
    const [account] = invite.existing
      ? await db.all<{ locale: string }>(
          "SELECT locale FROM users WHERE email=$1",
          [invite.email],
        )
      : [];
    const french = (account?.locale ?? invite.locale) === "fr",
      inviter = short(invite.inviter, 120),
      title = invite.title ? short(invite.title, 150) : "",
      what = {
        session: french
          ? `à préparer ou animer la séance « ${title} »`
          : `to prepare or run the session “${title}”`,
        workspace: french
          ? `à rejoindre l’espace de travail « ${title} »`
          : `to join the workspace “${title}”`,
        account: french ? "à rejoindre MeetLoom" : "to join MeetLoom",
      }[invite.kind];
    try {
      await send(
        { id: "", email: invite.email, name: "", locale: french ? "fr" : "en" },
        invite.existing
          ? french
            ? `MeetLoom — ${inviter} vous a ajouté${title ? ` : ${title}` : ""}`
            : `MeetLoom — ${inviter} added you${title ? `: ${title}` : ""}`
          : french
            ? `MeetLoom — ${inviter} vous invite${title ? ` : ${title}` : ""}`
            : `MeetLoom — ${inviter} invites you${title ? `: ${title}` : ""}`,
        invite.existing
          ? `${inviter} ${french ? "vous a ajouté" : "added you"} ${what}.\n\n${origin}${invite.path}`
          : `${inviter} ${french ? "vous invite" : "invites you"} ${what}.\n\n${french ? "Ce lien personnel est valable 72 heures ; il vous permet de créer votre compte :" : "This personal link is valid for 72 hours and lets you create your account:"}\n${origin}${invite.path}\n\n${french ? "Ne le transférez pas. Si vous n’attendiez pas cette invitation, ignorez ce message." : "Do not forward it. If you did not expect this invitation, you can ignore this message."}`,
      );
      return true;
    } catch (error) {
      log.warn("SMTP delivery failed", smtpFailure(error));
      // Not sent: a new attempt may email them.
      await db.run("UPDATE mail_invitation_log SET sent_at=0 WHERE key=$1", [
        key,
      ]);
      return false;
    }
  };
  /**
   * Event emails (problem reports) go through a durable queue: written in the
   * transaction of the event itself, then sent by whichever pod claims them
   * under a lease, and retried after a failure or a pod restart. Delivered
   * rows are deleted, so message bodies do not linger. Invitations are not
   * queued: their links must never be stored in clear (see `invitation`).
   */
  /** What a queued email is about, rechecked when it is sent: an
   * administrator's report, one's own report, or a session's organizers. */
  type Scope =
    | { purpose: "administrator" }
    | { purpose: "author" }
    | { purpose: "organizer"; target: string };
  const enqueue = async (
    sql: Sql,
    recipient: Recipient,
    subject: string,
    text: string,
    scope: Scope,
  ) => {
    const id = randomUUID();
    await sql.run(
      "INSERT INTO mail_outbox(id,user_id,email,subject,body,lease_until,attempts,created_at) VALUES($1,$2,$3,$4,$5,0,0,$6)",
      [id, recipient.id, recipient.email, short(subject), text, Date.now()],
    );
    await sql.run(
      "INSERT INTO mail_outbox_scope(id,purpose,target) VALUES($1,$2,$3)",
      [id, scope.purpose, "target" in scope ? scope.target : null],
    );
  };
  /** Whether the recipient still has the access the email is about. */
  async function stillEntitled(id: string, userId: string) {
    const [scope] = await db.all<{ purpose: string; target: string | null }>(
      "SELECT purpose,target FROM mail_outbox_scope WHERE id=$1",
      [id],
    );
    if (scope?.purpose === "administrator")
      return (
        (
          await db.all("SELECT id FROM users WHERE id=$1 AND is_admin=1", [
            userId,
          ])
        ).length > 0
      );
    if (scope?.purpose === "organizer")
      return (await sessionCollaborators(db, scope.target ?? "")).some(
        (member) => member.id === userId && member.role !== "viewer",
      );
    return true;
  }
  async function drainOutbox(now = Date.now()) {
    if (!config || !transport || closing) return;
    const rows = await db.all<{
      id: string;
      user_id: string;
      email: string;
      subject: string;
      body: string;
    }>(
      "SELECT id,user_id,email,subject,body FROM mail_outbox WHERE lease_until<=$1 AND attempts<5 ORDER BY created_at,id LIMIT 50",
      [now],
    );
    for (const row of rows) {
      if (closing) break;
      // One pod sends each email: the others see the lease and skip it.
      if (
        !(await db.run(
          "UPDATE mail_outbox SET lease_until=$1,attempts=attempts+1 WHERE id=$2 AND lease_until<=$3 AND attempts<5",
          [now + 60000, row.id, now],
        ))
      )
        continue;
      try {
        const [active] = await currentRecipient(db, row.user_id);
        // An account since disabled, readdressed or no longer entitled
        // (administrator rights, a role in the session) gets nothing.
        if (
          active &&
          active.email === row.email &&
          (await stillEntitled(row.id, row.user_id))
        )
          await send(active, row.subject, row.body);
        await db.run("DELETE FROM mail_outbox_scope WHERE id=$1", [row.id]);
        await db.run("DELETE FROM mail_outbox WHERE id=$1", [row.id]);
      } catch (error) {
        await db.run("UPDATE mail_outbox SET lease_until=$1 WHERE id=$2", [
          now + 5 * 60 * 1000,
          row.id,
        ]);
        log.warn("SMTP delivery failed", smtpFailure(error));
      }
    }
    // Given up after five attempts: kept a week for the logs, then dropped.
    await db.run(
      "DELETE FROM mail_outbox_scope WHERE id IN (SELECT id FROM mail_outbox WHERE attempts>=5 AND created_at<$1)",
      [now - 7 * day],
    );
    await db.run(
      "DELETE FROM mail_outbox WHERE attempts>=5 AND created_at<$1",
      [now - 7 * day],
    );
  }
  /** Each problem report or idea, for the other active administrators who
   * keep that preference on. Call inside the report's transaction. */
  const feedbackReceived = async (
    sql: Sql,
    report: {
      authorId: string;
      authorName: string;
      authorEmail: string;
      kind: "bug" | "idea" | "other";
      message: string;
      page: string | null;
    },
  ) => {
    if (!config) return;
    const admins = await sql.all<Recipient>(
      "SELECT id,email,name,locale FROM users WHERE is_admin=1 AND id<>$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id) ORDER BY id",
      [report.authorId],
    );
    for (const admin of admins) {
      if (
        (await accountProfile(sql, admin.id)).preferences.emailFeedback ===
        false
      )
        continue;
      const french = admin.locale === "fr",
        kind = {
          bug: french ? "Problème" : "Problem",
          idea: french ? "Idée" : "Idea",
          other: french ? "Autre" : "Other",
        }[report.kind];
      await enqueue(
        sql,
        admin,
        `MeetLoom — ${kind} : ${short(report.message, 80)}`,
        `${kind} — ${short(report.authorName, 120)} <${report.authorEmail}>${report.page ? `\n${french ? "Page" : "Page"} : ${short(report.page, 300)}` : ""}\n\n${report.message.slice(0, 4000)}\n\n${french ? "Traiter les retours :" : "Triage reports:"} ${origin}/account/feedback-inbox\n\n${french ? "Désactivez ces e-mails dans votre profil." : "Turn these emails off in your profile."}`,
        { purpose: "administrator" },
      );
    }
  };
  /** The author of a report, when an administrator moves it on. Call inside
   * the status change's transaction. */
  const feedbackStatusChanged = async (
    sql: Sql,
    change: {
      authorId: string;
      kind: "bug" | "idea" | "other";
      message: string;
      status: "new" | "in-progress" | "done" | "dismissed";
    },
  ) => {
    if (!config) return;
    const [author] = await currentRecipient(sql, change.authorId);
    if (
      !author ||
      (await accountProfile(sql, author.id)).preferences.emailFeedback === false
    )
      return;
    const french = author.locale === "fr",
      status = {
        new: french ? "reçu" : "received",
        "in-progress": french ? "en cours de traitement" : "in progress",
        done: french ? "traité" : "done",
        dismissed: french ? "classé sans suite" : "closed without action",
      }[change.status],
      what = {
        bug: french ? "Votre signalement" : "Your report",
        idea: french ? "Votre idée" : "Your idea",
        other: french ? "Votre message" : "Your message",
      }[change.kind];
    await enqueue(
      sql,
      author,
      `MeetLoom — ${what} : ${status}`,
      `${what} ${french ? "est maintenant" : "is now"} : ${status}.\n\n« ${short(change.message, 300)} »\n\n${french ? "Suivre vos retours :" : "Follow your reports:"} ${origin}/account/feedback\n\n${french ? "Désactivez ces e-mails dans votre profil." : "Turn these emails off in your profile."}`,
      { purpose: "author" },
    );
  };
  /** A timer nobody stopped (forgotten-runs.ts): a reminder during the day,
   * then word that it was stopped at night. Call inside that transaction. */
  const forgottenRun = async (
    sql: Sql,
    session: { id: string; title: string },
    kind: "remind" | "stop",
    recipients: string[],
  ) => {
    if (!config) return;
    for (const id of recipients) {
      const [recipient] = await currentRecipient(sql, id);
      if (!recipient) continue;
      const french = recipient.locale === "fr",
        title = short(session.title, 150);
      await enqueue(
        sql,
        recipient,
        kind === "remind"
          ? french
            ? `MeetLoom — le minuteur tourne encore : ${title}`
            : `MeetLoom — the timer is still running: ${title}`
          : french
            ? `MeetLoom — minuteur arrêté automatiquement : ${title}`
            : `MeetLoom — timer stopped automatically: ${title}`,
        kind === "remind"
          ? french
            ? `Le minuteur de « ${title} » tourne encore, plus d’une heure après la fin prévue. Si la séance est terminée, pensez à l’arrêter :\n${origin}/session/${session.id}\n\nS’il tourne encore dans la nuit, MeetLoom l’arrêtera automatiquement.`
            : `The timer of “${title}” is still running, more than an hour past its planned end. If the session is over, remember to stop it:\n${origin}/session/${session.id}\n\nIf it is still running at night, MeetLoom will stop it automatically.`
          : french
            ? `Le minuteur de « ${title} » tournait encore cette nuit : MeetLoom l’a arrêté. L’étape en cours est comptée avec sa durée prévue ; le déroulé est dans l’historique de la séance.\n${origin}/session/${session.id}`
            : `The timer of “${title}” was still running at night: MeetLoom stopped it. The current step counts for its planned duration; the run is in the session history.\n${origin}/session/${session.id}`,
        { purpose: "organizer", target: session.id },
      );
    }
  };
  // Every pod sweeps the queue, so an email outlives the pod that queued it.
  const outboxInterval = config
    ? setInterval(() => background(() => drainOutbox()), 60000)
    : undefined;
  outboxInterval?.unref();
  const interval = config?.scheduled
    ? setInterval(() => background(() => scheduled()), 60000)
    : undefined;
  interval?.unref();
  return {
    enabled: !!config,
    scheduled,
    feedbackReceived,
    feedbackStatusChanged,
    forgottenRun,
    /** Sends what the queue holds now, in the background; `now` lets tests
     * pass the retry delay. Awaiting it waits for that send. */
    deliverQueued(now?: number) {
      let sent: Promise<void> = Promise.resolve();
      background(() => {
        sent = drainOutbox(now);
        return sent;
      });
      return sent;
    },
    invitation,
    async flush() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    async close() {
      closing = true;
      if (interval) clearInterval(interval);
      if (outboxInterval) clearInterval(outboxInterval);
      while (pending.size) await Promise.allSettled([...pending]);
      transport?.close?.();
    },
  };
}
