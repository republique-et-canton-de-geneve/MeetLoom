import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import type { Role, Session, User } from "../shared/model.js";
import type {
  PresentParticipant,
  PresenceResponse,
} from "../shared/presence.js";
import { allBlocks } from "../shared/domain.js";
import { fail } from "./security.js";
import { sessionCollaborators } from "./collaborators.js";

type Member = Pick<PresentParticipant, "userId" | "name" | "role">;
type Heartbeat = {
  sessionId: string;
  userId: string;
  clientId: string;
  blockId: string | null;
  editing: boolean;
};
type Row = {
  user_id: string;
  client_id: string;
  block_id: string | null;
  editing: number | boolean;
  last_seen: number | string;
};
/** Ephemeral heartbeats, kept in the database (table created with the core
 * schema) so that every application pod sees the same collaborators. Rows
 * expire after the TTL; no activity history is kept. Membership is checked
 * again on every response. */
export class PresenceStore {
  constructor(
    private db: Sql,
    readonly ttlMs = 30_000,
    private now = Date.now,
    private limit = 5000,
  ) {}
  private async prune() {
    await this.db.run("DELETE FROM presence_heartbeats WHERE last_seen <= $1", [
      this.now() - this.ttlMs,
    ]);
  }
  async touch(value: Heartbeat) {
    await this.prune();
    const existing = await this.db.all(
      "SELECT 1 AS found FROM presence_heartbeats WHERE session_id=$1 AND user_id=$2 AND client_id=$3",
      [value.sessionId, value.userId, value.clientId],
    );
    if (!existing.length) {
      const [counts] = await this.db.all<{ total: number; mine: number }>(
        "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN user_id=$1 THEN 1 ELSE 0 END),0) AS mine FROM presence_heartbeats",
        [value.userId],
      );
      if (Number(counts.total) >= this.limit || Number(counts.mine) >= 20)
        fail(429, "PRESENCE_LIMIT", "Too many active presence windows.");
    }
    await this.db.run(
      "INSERT INTO presence_heartbeats(session_id,user_id,client_id,block_id,editing,last_seen) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(session_id,user_id,client_id) DO UPDATE SET block_id=excluded.block_id, editing=excluded.editing, last_seen=excluded.last_seen",
      [
        value.sessionId,
        value.userId,
        value.clientId,
        value.blockId,
        value.editing ? 1 : 0,
        this.now(),
      ],
    );
  }
  async leave(sessionId: string, userId: string, clientId: string) {
    await this.prune();
    await this.db.run(
      "DELETE FROM presence_heartbeats WHERE session_id=$1 AND user_id=$2 AND client_id=$3",
      [sessionId, userId, clientId],
    );
  }
  async list(sessionId: string, members: Member[]): Promise<PresenceResponse> {
    await this.prune();
    const allowed = new Map(members.map((member) => [member.userId, member])),
      users = new Map<string, PresentParticipant>();
    const rows = await this.db.all<Row>(
      "SELECT user_id,client_id,block_id,editing,last_seen FROM presence_heartbeats WHERE session_id=$1",
      [sessionId],
    );
    for (const row of rows) {
      const member = allowed.get(row.user_id);
      if (!member) {
        await this.db.run(
          "DELETE FROM presence_heartbeats WHERE session_id=$1 AND user_id=$2",
          [sessionId, row.user_id],
        );
        continue;
      }
      const lastSeen = Number(row.last_seen),
        editing = Boolean(Number(row.editing));
      const previous = users.get(row.user_id);
      const latest = !previous || lastSeen >= previous.lastSeen;
      users.set(row.user_id, {
        ...member,
        blockId: latest ? row.block_id : previous.blockId,
        editing:
          ["owner", "editor"].includes(member.role) &&
          (latest ? editing : previous.editing),
        lastSeen: Math.max(previous?.lastSeen ?? 0, lastSeen),
        devices: (previous?.devices ?? 0) + 1,
      });
    }
    return {
      participants: [...users.values()].sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
      ),
      serverTime: this.now(),
      expiresInMs: this.ttlMs,
    };
  }
}

export function createPresenceRouter(dependencies: {
  db: Database;
  authenticated: RequestHandler;
  accessible: (
    sessionId: string,
    userId: string,
  ) => Promise<{ session: Session; role: Role }>;
  store?: PresenceStore;
}) {
  const router = Router(),
    store = dependencies.store ?? new PresenceStore(dependencies.db);
  const path = "/sessions/:id/presence";
  router.use(path, dependencies.authenticated);
  const getId = (value: unknown) => z.string().min(1).max(80).parse(value);
  const members = async (sessionId: string) =>
    (await sessionCollaborators(dependencies.db, sessionId)).map(
      ({ id, ...member }) => ({ ...member, userId: id }),
    );
  router.get(path, async (request, response) => {
    const id = getId(request.params.id),
      user = response.locals.user as User;
    await dependencies.accessible(id, user.id);
    response.json(await store.list(id, await members(id)));
  });
  router.post(path, async (request, response) => {
    const id = getId(request.params.id),
      user = response.locals.user as User;
    const input = z
      .object({
        clientId: z.uuid(),
        blockId: z.string().min(1).max(80).nullable().default(null),
        editing: z.boolean().default(false),
      })
      .strict()
      .parse(request.body);
    const { session, role } = await dependencies.accessible(id, user.id);
    if (
      input.blockId &&
      !session.days.some((day) =>
        allBlocks(day.blocks).some((block) => block.id === input.blockId),
      )
    )
      return fail(400, "INVALID_BLOCK", "This block does not exist.");
    await store.touch({
      sessionId: id,
      userId: user.id,
      clientId: input.clientId,
      blockId: input.blockId,
      editing: input.editing && ["owner", "editor"].includes(role),
    });
    response.json(await store.list(id, await members(id)));
  });
  router.delete(path, async (request, response) => {
    const id = getId(request.params.id),
      user = response.locals.user as User;
    await dependencies.accessible(id, user.id);
    const input = z.object({ clientId: z.uuid() }).strict().parse(request.body);
    await store.leave(id, user.id, input.clientId);
    response.status(204).end();
  });
  return router;
}
