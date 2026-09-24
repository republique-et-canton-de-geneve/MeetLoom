import type { Express, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import type { Role, Session, User } from "../shared/model.js";
import type { Participant } from "../shared/participants.js";
import { participantSummary } from "../shared/participants.js";
import { sessionCollaborators } from "./collaborators.js";
import { allBlocks } from "../shared/domain.js";
import { guardSessionLifecycle } from "./lifecycle.js";
import { fail, hashToken, token } from "./security.js";

type Person = {
  id: string;
  session_id: string;
  user_id: string | null;
  email: string;
  name: string;
  role: Exclude<Role, "owner">;
  invite_hash: string | null;
  expires_at: number | string | null;
  created_by: string;
};
const id = z.string().min(1).max(80),
  who = (response: Response) => response.locals.user as User;
const role = z.enum(["editor", "facilitator", "viewer"]);
async function canCreateAccount(sql: Sql, sessionId: string, userId: string) {
  const [allowed] = await sql.all(
    "SELECT u.id FROM users u WHERE u.id=$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=u.id) AND (u.is_admin=1 OR EXISTS(SELECT 1 FROM session_workspaces sw JOIN workspace_members wm ON wm.workspace_id=sw.workspace_id WHERE sw.session_id=$2 AND wm.user_id=$1 AND wm.role='admin'))",
    [userId, sessionId],
  );
  return !!allowed;
}
async function sessionParticipants(
  sql: Sql,
  sessionId: string,
): Promise<Participant[]> {
  const members = await sessionCollaborators(sql, sessionId),
    people = await sql.all<Person>(
      "SELECT * FROM session_people WHERE session_id=$1 ORDER BY id",
      [sessionId],
    ),
    result: Participant[] = [];
  for (const member of members) {
    const linked =
      people.find(
        (person) => person.user_id === member.id && person.id !== member.id,
      ) ?? people.find((person) => person.user_id === member.id);
    const [profile] = await sql.all<{ payload: string }>(
      "SELECT payload FROM account_profiles WHERE user_id=$1",
      [member.id],
    );
    result.push({
      id: linked?.id ?? member.id,
      userId: member.id,
      name: member.name,
      role: member.role,
      pending: false,
      ...(profile ? { avatar: JSON.parse(profile.payload).avatar } : {}),
    });
  }
  for (const person of people.filter(
    (person) => !person.user_id && Number(person.expires_at) > Date.now(),
  )) {
    if (
      !(
        await sql.all(
          "SELECT token_hash FROM invites WHERE token_hash=$1 AND expires_at>$2",
          [person.invite_hash, Date.now()],
        )
      ).length
    )
      continue;
    result.push({
      id: person.id,
      name: person.name,
      role: person.role,
      pending: true,
    });
  }
  return result.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/** Called inside agenda CAS. An assignment never grants access. Persisted session
 * participant IDs remain usable by history restores after membership is revoked. */
export async function normalizeAssignments(sql: Sql, session: Session) {
  const assigned = allBlocks(session.days.flatMap((day) => day.blocks)).filter(
    (block) => block.assignees?.length,
  );
  if (!assigned.length) return;
  const members = await sessionCollaborators(sql, session.id),
    people = await sql.all<Person>(
      "SELECT * FROM session_people WHERE session_id=$1",
      [session.id],
    );
  for (const block of assigned) {
    const seen = new Set<string>();
    block.assignees = await Promise.all(
      block.assignees!.map(async (assignee) => {
        const person = people.find((person) => person.id === assignee.id),
          member = members.find(
            (member) => member.id === (person?.user_id ?? assignee.id),
          );
        if (!person && !member)
          fail(
            400,
            "INVALID_ASSIGNEE",
            "An assigned person does not belong to this session.",
          );
        const identity = person?.user_id ?? assignee.id;
        if (seen.has(identity))
          fail(
            400,
            "INVALID_ASSIGNEE",
            "The same person cannot be assigned twice.",
          );
        seen.add(identity);
        const name = member?.name ?? person!.name;
        if (!person) {
          const [account] = await sql.all<{ email: string }>(
            "SELECT email FROM users WHERE id=$1",
            [member!.id],
          );
          await sql.run(
            "INSERT INTO session_people(id,session_id,user_id,email,name,role,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(session_id,id) DO NOTHING",
            [
              assignee.id,
              session.id,
              member!.id,
              account.email,
              name,
              member!.role === "owner" ? "editor" : member!.role,
              session.ownerId,
            ],
          );
        }
        return { id: assignee.id, name: name.slice(0, 120) };
      }),
    );
    block.facilitator = participantSummary(block.assignees);
  }
}

/** The invitation metadata remains after the one-use token is consumed, so the
 * opaque participant ID and every block assignment survive account creation. */
export async function acceptParticipantInvite(
  sql: Sql,
  inviteHash: string,
  userId: string,
) {
  const people = await sql.all<Person>(
    "SELECT * FROM session_people WHERE invite_hash=$1 AND user_id IS NULL AND expires_at>$2",
    [inviteHash, Date.now()],
  );
  const [account] = await sql.all<{ email: string }>(
    "SELECT email FROM users WHERE id=$1",
    [userId],
  );
  for (const person of people) {
    await sql.run("UPDATE sessions SET version=version WHERE id=$1", [
      person.session_id,
    ]);
    await guardSessionLifecycle(sql, person.session_id);
    const [session] = await sql.all<{ owner_id: string }>(
      "SELECT owner_id FROM sessions WHERE id=$1",
      [person.session_id],
    );
    if (
      account.email !== person.email ||
      session.owner_id !== person.created_by ||
      !(await canCreateAccount(sql, person.session_id, person.created_by))
    )
      fail(410, "INVITE_INVALID", "This invitation is no longer authorized.");
    await sql.run(
      "INSERT INTO members(session_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(session_id,user_id) DO NOTHING",
      [person.session_id, userId, person.role],
    );
    await sql.run(
      "UPDATE session_people SET user_id=$1,invite_hash=NULL WHERE session_id=$2 AND id=$3",
      [userId, person.session_id, person.id],
    );
  }
}

export async function installParticipantsApi(
  app: Express,
  {
    db,
    accessible,
    authenticated,
  }: {
    db: Database;
    authenticated: RequestHandler;
    accessible: (
      id: string,
      userId: string,
      roles?: Role[],
    ) => Promise<{ session: Session; role: Role }>;
  },
) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS session_people (id TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),email TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,invite_hash TEXT,expires_at BIGINT,created_by TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(session_id,id))",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS session_people_invite_idx ON session_people(invite_hash)",
  );
  app.get("/api/sessions/:id/assignees", authenticated, async (req, res) => {
    const { session } = await accessible(id.parse(req.params.id), who(res).id);
    res.json({ participants: await sessionParticipants(db, session.id) });
  });
  app.get("/api/sessions/:id/invitations", authenticated, async (req, res) => {
    const { session } = await accessible(id.parse(req.params.id), who(res).id, [
      "owner",
    ]);
    const rows = await db.all<Person & { activeHash: string | null }>(
      'SELECT p.*,i.token_hash AS "activeHash" FROM session_people p LEFT JOIN invites i ON i.token_hash=p.invite_hash AND i.expires_at>$2 WHERE p.session_id=$1 AND p.user_id IS NULL ORDER BY p.name',
      [session.id, Date.now()],
    );
    res.json({
      invitations: rows.map((person) => ({
        id: person.id,
        name: person.name,
        email: person.email,
        role: person.role,
        expiresAt: new Date(Number(person.expires_at)).toISOString(),
        active: !!person.activeHash,
      })),
      canInviteNew: await canCreateAccount(db, session.id, who(res).id),
    });
  });
  app.post("/api/sessions/:id/invitations", authenticated, async (req, res) => {
    const input = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((value) => value.toLowerCase()),
          name: z.string().trim().min(1).max(120),
          role: role.default("editor"),
        })
        .strict()
        .parse(req.body),
      user = who(res),
      { session } = await accessible(id.parse(req.params.id), user.id, [
        "owner",
      ]);
    const result = await db.transaction(async (sql) => {
      await sql.run("UPDATE sessions SET version=version WHERE id=$1", [
        session.id,
      ]);
      await guardSessionLifecycle(sql, session.id, { write: true });
      const [current] = await sql.all<{ owner_id: string }>(
        "SELECT owner_id FROM sessions WHERE id=$1",
        [session.id],
      );
      if (current.owner_id !== user.id)
        fail(
          403,
          "FORBIDDEN",
          "Only the owner can invite session collaborators.",
        );
      const [account] = await sql.all<{
        id: string;
        name: string;
        disabled: string | null;
      }>(
        "SELECT u.id,u.name,d.user_id AS disabled FROM users u LEFT JOIN account_disabled d ON d.user_id=u.id WHERE u.email=$1",
        [input.email],
      );
      if (account?.disabled)
        fail(400, "ACCOUNT_UNAVAILABLE", "This account is unavailable.");
      const [pending] = await sql.all<Person>(
        "SELECT * FROM session_people WHERE session_id=$1 AND email=$2 AND user_id IS NULL ORDER BY id LIMIT 1",
        [session.id, input.email],
      );
      const personId = pending?.id ?? account?.id ?? randomUUID();
      if (account) {
        if (account.id !== session.ownerId)
          await sql.run(
            "INSERT INTO members(session_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(session_id,user_id) DO UPDATE SET role=excluded.role",
            [session.id, account.id, input.role],
          );
        if (pending) {
          await sql.run("DELETE FROM invites WHERE token_hash=$1", [
            pending.invite_hash,
          ]);
          await sql.run(
            "UPDATE session_people SET user_id=$1,name=$2,role=$3,invite_hash=NULL WHERE session_id=$4 AND id=$5",
            [account.id, account.name, input.role, session.id, pending.id],
          );
        }
        return {
          participant: {
            id: personId,
            userId: account.id,
            name: account.name,
            role: account.id === session.ownerId ? "owner" : input.role,
            pending: false,
          },
          token: undefined,
        };
      }
      if (!(await canCreateAccount(sql, session.id, user.id)))
        fail(
          403,
          "ACCOUNT_INVITE_FORBIDDEN",
          "A global or workspace administrator must invite a new account.",
        );
      const raw = token(),
        hash = hashToken(raw),
        expires = Date.now() + 72 * 60 * 60 * 1000;
      if (pending?.invite_hash)
        await sql.run("DELETE FROM invites WHERE token_hash=$1", [
          pending.invite_hash,
        ]);
      await sql.run(
        "INSERT INTO invites(token_hash,email,name,expires_at,created_by) VALUES($1,$2,$3,$4,$5)",
        [hash, input.email, input.name, expires, user.id],
      );
      await sql.run(
        "INSERT INTO session_people(id,session_id,email,name,role,invite_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(session_id,id) DO UPDATE SET name=excluded.name,role=excluded.role,invite_hash=excluded.invite_hash,expires_at=excluded.expires_at,created_by=excluded.created_by",
        [
          personId,
          session.id,
          input.email,
          input.name,
          input.role,
          hash,
          expires,
          user.id,
        ],
      );
      return {
        participant: {
          id: personId,
          name: input.name,
          role: input.role,
          pending: true,
        },
        token: raw,
        expiresAt: new Date(expires).toISOString(),
      };
    });
    res.status(201).json(result);
  });
  app.delete(
    "/api/sessions/:id/invitations/:personId",
    authenticated,
    async (req, res) => {
      const { session } = await accessible(
          id.parse(req.params.id),
          who(res).id,
          ["owner"],
        ),
        personId = id.parse(req.params.personId);
      await db.transaction(async (sql) => {
        await sql.run("UPDATE sessions SET version=version WHERE id=$1", [
          session.id,
        ]);
        await guardSessionLifecycle(sql, session.id, { write: true });
        const [current] = await sql.all<{ owner_id: string }>(
          "SELECT owner_id FROM sessions WHERE id=$1",
          [session.id],
        );
        if (current.owner_id !== who(res).id)
          fail(
            403,
            "FORBIDDEN",
            "Only the owner can revoke session invitations.",
          );
        const [person] = await sql.all<Person>(
          "SELECT * FROM session_people WHERE session_id=$1 AND id=$2 AND user_id IS NULL",
          [session.id, personId],
        );
        if (!person) fail(404, "NOT_FOUND", "Invitation not found.");
        if (person.invite_hash)
          await sql.run("DELETE FROM invites WHERE token_hash=$1", [
            person.invite_hash,
          ]);
        await sql.run(
          "UPDATE session_people SET invite_hash=NULL,expires_at=0 WHERE session_id=$1 AND id=$2",
          [session.id, personId],
        );
      });
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/auth/accept-session-invite",
    authenticated,
    async (req, res) => {
      const input = z
          .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
          .strict()
          .parse(req.body),
        hash = hashToken(input.token),
        user = who(res);
      await db.transaction(async (sql) => {
        const [invite] = await sql.all<{ email: string }>(
          "SELECT email FROM invites WHERE token_hash=$1 AND expires_at>$2",
          [hash, Date.now()],
        );
        if (!invite || invite.email !== user.email)
          fail(
            410,
            "INVITE_INVALID",
            "This invitation is not available for your account.",
          );
        if (
          !(
            await sql.all(
              "SELECT id FROM session_people WHERE invite_hash=$1 AND user_id IS NULL",
              [hash],
            )
          ).length
        )
          fail(410, "INVITE_INVALID", "This is not a session invitation.");
        if (
          !(await sql.run(
            "DELETE FROM invites WHERE token_hash=$1 AND expires_at>$2",
            [hash, Date.now()],
          ))
        )
          fail(410, "INVITE_INVALID", "This invitation has already been used.");
        await acceptParticipantInvite(sql, hash, user.id);
      });
      res.json({ ok: true });
    },
  );
}
