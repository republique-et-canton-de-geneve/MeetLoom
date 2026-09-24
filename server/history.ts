import type { Express, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Block,
  Column,
  Day,
  Role,
  Session,
  SessionCategory,
  User,
} from "../shared/model.js";
import { INITIAL_RUN } from "../shared/model.js";
import { allBlocks, cloneBlockTree, runnableBlocks } from "../shared/domain.js";
import type { SessionPage, SessionForm } from "../shared/content.js";
import type {
  DeletedElement,
  HistoryChange,
  HistoryElementKind,
  JournalEntry,
  NamedVersion,
} from "../shared/history.js";
import {
  editableSessionSchema,
  sessionInputSchema,
} from "../shared/validation.js";
import { richTextToPlain } from "../shared/richtext.js";
import type { Database, Sql } from "./db.js";
import { fail } from "./security.js";

const TRASH_TTL = 72 * 60 * 60 * 1000;
const identifier = z.string().min(1).max(120);
const expected = z.number().int().nonnegative();
const metadataInput = z
  .object({
    version: expected,
    revision: expected.default(0),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(""),
  })
  .strict();
type Options = {
  db: Database;
  authenticated: RequestHandler;
  accessible: (
    id: string,
    userId: string,
    allowed?: Role[],
  ) => Promise<{ session: Session; role: Role }>;
  save: (
    before: Session,
    next: Session,
    author: string,
    label?: string,
    commit?: (sql: Sql) => Promise<void>,
  ) => Promise<Session>;
};
type Element = {
  kind: Exclude<HistoryElementKind, "session">;
  id: string;
  title: string;
  value: Block | Day | SessionPage | SessionForm;
  dayId?: string;
  parentId?: string;
  roomId?: string;
  ancestors: string[];
  index: number;
  location: string;
};
type TrashPayload = {
  element: Element;
  columns: Column[];
  categories?: SessionCategory[];
};
type TrashRow = {
  id: string;
  session_id: string;
  payload: string;
  user_id: string;
  deleted_at: string;
  expires_at: string;
  restored_at: string | null;
  author: string;
  kind: DeletedElement["kind"];
  title: string;
  location: string;
  original_day_id: string | null;
};
type VersionRow = {
  id: string;
  payload: string;
  label: string;
  created_at: string;
  author: string;
  name: string | null;
  description: string | null;
  revision: number | null;
};
const actor = (response: Response) => response.locals.user as User;
const parameter = (request: Request, key: string) =>
  identifier.parse(request.params[key]);
const missing = () =>
  fail(404, "NOT_FOUND", "This history item is unavailable.");
const conflict = () =>
  fail(
    409,
    "VERSION_CONFLICT",
    "The agenda or history item changed. Reload and retry.",
  );
const active = (session: Session) =>
  ["running", "paused"].includes(session.run.status);

function elements(session: Session): Map<string, Element> {
  const result = new Map<string, Element>();
  const visit = (
    blocks: Block[],
    day: Day,
    ancestors: string[],
    location: string,
    parentId?: string,
    roomId?: string,
  ) =>
    blocks.forEach((block, index) => {
      result.set(block.id, {
        kind: "block",
        id: block.id,
        title: block.title,
        value: block,
        dayId: day.id,
        parentId,
        roomId,
        ancestors,
        index,
        location,
      });
      if (block.children)
        visit(
          block.children,
          day,
          [...ancestors, block.id],
          `${location} / ${block.title}`,
          block.id,
        );
      for (const room of block.rooms ?? [])
        visit(
          room.blocks,
          day,
          [...ancestors, block.id],
          `${location} / ${block.title} / ${room.title}`,
          block.id,
          room.id,
        );
    });
  session.days.forEach((day, index) => {
    result.set(day.id, {
      kind: "day",
      id: day.id,
      title: day.title,
      value: day,
      ancestors: [],
      index,
      location: session.title,
    });
    visit(day.blocks, day, [day.id], day.title);
  });
  session.pages?.forEach((page, index) =>
    result.set(page.id, {
      kind: "page",
      id: page.id,
      title: page.title,
      value: page,
      ancestors: [],
      index,
      location: session.title,
    }),
  );
  session.forms?.forEach((form, index) =>
    result.set(form.id, {
      kind: "form",
      id: form.id,
      title: form.title,
      value: form,
      ancestors: [],
      index,
      location: session.title,
    }),
  );
  return result;
}
function plain(value: unknown): string {
  const content =
    typeof value === "string"
      ? richTextToPlain(value)
      : Array.isArray(value)
        ? value.map(plain).join(", ")
        : value && typeof value === "object"
          ? Object.entries(value)
              .map(([key, item]) => `${key}: ${plain(item)}`)
              .join("; ")
          : String(value ?? "");
  return content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}
function comparable(element: Element): Record<string, unknown> {
  const value = element.value as unknown as Record<string, unknown>;
  const keys =
    element.kind === "block"
      ? [
          "title",
          "description",
          "duration",
          "category",
          "facilitator",
          "section",
          "lockedStart",
          "kind",
        ]
      : element.kind === "day"
        ? ["title", "date", "startTime"]
        : element.kind === "page"
          ? ["title", "visibility", "sections"]
          : ["title", "description", "identityMode", "questions"];
  return {
    ...Object.fromEntries(keys.map((key) => [key, value[key]])),
    ...(element.kind === "block"
      ? Object.fromEntries(
          Object.entries((element.value as Block).fields).map(
            ([key, content]) => [`column:${key}`, content],
          ),
        )
      : {}),
  };
}
function difference(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((field) => ({
      field,
      before: plain(before[field]),
      after: plain(after[field]),
    }));
}

/** Runs inside the same transaction as the session CAS, so no journal/trash can
 * outlive a failed save. Deleted parents retain their subtree only once. */
export async function recordHistory(
  sql: Sql,
  before: Session,
  after: Session,
  author: string,
  label: string,
): Promise<void> {
  const old = elements(before),
    next = elements(after),
    changes: HistoryChange[] = [];
  const fields = [
    "title",
    "description",
    "client",
    "tags",
    "folder",
    "timezone",
    "columns",
    "categories",
    "sound",
    "archived",
    "contentOrder",
  ] as const;
  const sessionChanges = difference(
    Object.fromEntries(fields.map((key) => [key, before[key]])),
    Object.fromEntries(fields.map((key) => [key, after[key]])),
  );
  if (sessionChanges.length)
    changes.push({
      kind: "session",
      id: after.id,
      title: after.title,
      action: "changed",
      fields: sessionChanges,
    });
  for (const prior of old.values()) {
    const current = next.get(prior.id);
    if (!current) {
      changes.push({
        kind: prior.kind,
        id: prior.id,
        title: prior.title,
        action: "deleted",
        fields: [],
      });
      if (!prior.ancestors.some((id) => !next.has(id))) {
        const payload: TrashPayload = {
          element: prior,
          columns: before.columns,
          categories: before.categories,
        };
        await sql.run(
          "INSERT INTO deleted_elements(id,session_id,payload,user_id,deleted_at,expires_at,restored_at,kind,title,location,original_day_id) VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)",
          [
            randomUUID(),
            before.id,
            JSON.stringify(payload),
            author,
            after.updatedAt,
            new Date(Date.parse(after.updatedAt) + TRASH_TTL).toISOString(),
            prior.kind,
            prior.title,
            prior.location,
            prior.dayId ?? null,
          ],
        );
      }
      continue;
    }
    const changed = difference(comparable(prior), comparable(current));
    if (changed.length)
      changes.push({
        kind: current.kind,
        id: current.id,
        title: current.title,
        action: "changed",
        fields: changed,
      });
    if (
      prior.index !== current.index ||
      prior.parentId !== current.parentId ||
      prior.roomId !== current.roomId ||
      prior.dayId !== current.dayId
    )
      changes.push({
        kind: current.kind,
        id: current.id,
        title: current.title,
        action: "moved",
        fields: [
          {
            field: "location",
            before: `${prior.location} · ${prior.index + 1}`,
            after: `${current.location} · ${current.index + 1}`,
          },
        ],
      });
  }
  for (const item of next.values())
    if (!old.has(item.id))
      changes.push({
        kind: item.kind,
        id: item.id,
        title: item.title,
        action: "added",
        fields: [],
      });
  if (changes.length)
    await sql.run(
      "INSERT INTO session_journal(id,session_id,user_id,created_at,label,session_version,payload) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        randomUUID(),
        before.id,
        author,
        after.updatedAt,
        label,
        after.version,
        JSON.stringify({
          changes: changes.slice(0, 300),
          omittedChanges: Math.max(0, changes.length - 300),
        }),
      ],
    );
  await sql.run(
    "DELETE FROM session_journal WHERE session_id = $1 AND id NOT IN (SELECT id FROM session_journal WHERE session_id = $1 ORDER BY session_version DESC,id DESC LIMIT 1000)",
    [before.id],
  );
  await sql.run(
    "DELETE FROM deleted_elements WHERE id IN (SELECT id FROM deleted_elements WHERE expires_at <= $1 ORDER BY expires_at LIMIT 500)",
    [after.updatedAt],
  );
}

function versionValue(row: VersionRow): NamedVersion {
  return {
    id: row.id,
    label: row.name ?? row.label,
    description: row.description ?? "",
    named: row.name !== null,
    revision: row.revision ?? 0,
    createdAt: row.created_at,
    author: row.author,
    ...(row.payload
      ? { sessionVersion: (JSON.parse(row.payload) as Session).version }
      : {}),
  };
}
function trashValue(row: TrashRow): DeletedElement {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    author: row.author,
    deletedAt: row.deleted_at,
    expiresAt: row.expires_at,
    location: row.location,
    originalDayId: row.original_day_id ?? undefined,
  };
}
function mergeDefinitions(
  target: Session,
  source: Pick<Session, "columns" | "categories">,
): void {
  // A historical private field must never become public simply because its
  // column was deleted or its visibility changed in the current document.
  for (const column of source.columns) {
    const existing = target.columns.find((item) => item.id === column.id);
    if (!existing) target.columns.push({ ...column, visibility: "team" });
    else if (column.visibility === "team") existing.visibility = "team";
  }
  for (const category of source.categories ?? [])
    if (!target.categories?.some((item) => item.id === category.id))
      (target.categories ??= []).push(structuredClone(category));
}
function guardDay(session: Session, dayId?: string): void {
  if (active(session) && (!dayId || session.run.dayId === dayId))
    fail(409, "HISTORY_RUN_ACTIVE", "Stop the timer before restoring its day.");
}
function reconcileRun(before: Session, candidate: Session): void {
  candidate.run = structuredClone(before.run);
  if (
    !active(before) &&
    (!candidate.days.some((day) => day.id === candidate.run.dayId) ||
      (candidate.run.blockId &&
        !runnableBlocks(
          candidate.days.find((day) => day.id === candidate.run.dayId)
            ?.blocks ?? [],
        ).some((block) => block.id === candidate.run.blockId)))
  )
    candidate.run = {
      ...INITIAL_RUN,
      dayId: candidate.days[0].id,
      revision: before.run.revision + 1,
    };
}

function recoveredBlocks(blocks: Block[], session: Session): Block[] {
  const existing = new Set(
    session.days.flatMap((day) =>
      allBlocks(day.blocks).map((block) => block.id),
    ),
  );
  const rooms = new Set(
    session.days.flatMap((day) =>
      allBlocks(day.blocks).flatMap((block) =>
        (block.rooms ?? []).map((room) => room.id),
      ),
    ),
  );
  const recover = (items: Block[]): Block[] =>
    items
      .filter((block) => !existing.has(block.id))
      .map((block) => ({
        ...structuredClone(block),
        ...(block.children ? { children: recover(block.children) } : {}),
        ...(block.rooms
          ? {
              rooms: block.rooms.map((room) => ({
                ...structuredClone(room),
                id: rooms.has(room.id) ? randomUUID() : room.id,
                blocks: recover(room.blocks),
              })),
            }
          : {}),
      }));
  return recover(blocks);
}

export async function installHistoryApi(
  app: Express,
  { db, accessible, authenticated, save }: Options,
): Promise<void> {
  await db.transaction(async (sql) => {
    await sql.run(
      "CREATE TABLE IF NOT EXISTS version_metadata (version_id TEXT PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL, revision INTEGER NOT NULL)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS session_journal (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, label TEXT NOT NULL, session_version INTEGER NOT NULL, payload TEXT NOT NULL)",
    );
    await sql.run(
      "CREATE INDEX IF NOT EXISTS journal_session_idx ON session_journal(session_id,session_version)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS deleted_elements (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, payload TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), deleted_at TEXT NOT NULL, expires_at TEXT NOT NULL, restored_at TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, location TEXT NOT NULL, original_day_id TEXT)",
    );
    await sql.run(
      "CREATE INDEX IF NOT EXISTS deleted_elements_session_idx ON deleted_elements(session_id,deleted_at)",
    );
    await sql.run(
      "CREATE INDEX IF NOT EXISTS deleted_elements_expiry_idx ON deleted_elements(expires_at)",
    );
  });
  const prefix = "/api/sessions/:id";
  const access = (request: Request, response: Response, write = false) =>
    accessible(
      parameter(request, "id"),
      actor(response).id,
      write ? ["owner", "editor"] : undefined,
    );
  const lock = async (sql: Sql, session: Session, version: number) => {
    if (
      session.version !== version ||
      !(await sql.run(
        "UPDATE sessions SET version = version WHERE id = $1 AND version = $2",
        [session.id, version],
      ))
    )
      conflict();
  };
  const versionRow = async (id: string, sessionId: string, sql: Sql = db) => {
    const [row] = await sql.all<VersionRow>(
      "SELECT v.*,u.name AS author,m.name,m.description,m.revision FROM versions v JOIN users u ON u.id = v.user_id LEFT JOIN version_metadata m ON m.version_id = v.id WHERE v.id = $1 AND v.session_id = $2",
      [id, sessionId],
    );
    if (!row) return missing();
    return row;
  };
  const checkNamedLimit = async (sql: Sql, sessionId: string) => {
    const [row] = await sql.all<{ count: number | string }>(
      "SELECT COUNT(*) AS count FROM version_metadata m JOIN versions v ON v.id = m.version_id WHERE v.session_id = $1",
      [sessionId],
    );
    if (Number(row.count) >= 100)
      fail(
        409,
        "HISTORY_LIMIT",
        "Remove an old named version before adding another (limit 100).",
      );
  };
  app.get(`${prefix}/versions`, authenticated, async (request, response) => {
    const { session } = await access(request, response);
    const rows = await db.all<VersionRow>(
      "SELECT v.id,v.label,v.created_at,u.name AS author,m.name,m.description,m.revision FROM versions v JOIN users u ON u.id = v.user_id LEFT JOIN version_metadata m ON m.version_id = v.id WHERE v.session_id = $1 ORDER BY v.created_at DESC,v.id DESC LIMIT 200",
      [session.id],
    );
    response.json({ versions: rows.map(versionValue) });
  });
  app.post(`${prefix}/versions`, authenticated, async (request, response) => {
    const input = metadataInput.parse(request.body),
      { session } = await access(request, response, true),
      id = randomUUID();
    await db.transaction(async (sql) => {
      await lock(sql, session, input.version);
      await checkNamedLimit(sql, session.id);
      await sql.run(
        "INSERT INTO versions(id,session_id,payload,user_id,label,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          session.id,
          JSON.stringify(session),
          actor(response).id,
          "Named version",
          new Date().toISOString(),
        ],
      );
      await sql.run(
        "INSERT INTO version_metadata(version_id,name,description,revision) VALUES($1,$2,$3,1)",
        [id, input.name, input.description],
      );
    });
    response
      .status(201)
      .json({ version: versionValue(await versionRow(id, session.id)) });
  });
  app.get(
    `${prefix}/versions/:versionId`,
    authenticated,
    async (request, response) => {
      const { session } = await access(request, response),
        row = await versionRow(parameter(request, "versionId"), session.id);
      response.json({
        version: versionValue(row),
        session: JSON.parse(row.payload),
      });
    },
  );
  app.patch(
    `${prefix}/versions/:versionId`,
    authenticated,
    async (request, response) => {
      const input = metadataInput.parse(request.body),
        { session } = await access(request, response, true),
        id = parameter(request, "versionId");
      await db.transaction(async (sql) => {
        await lock(sql, session, input.version);
        const row = await versionRow(id, session.id, sql);
        if ((row.revision ?? 0) !== input.revision) conflict();
        if (!row.name) await checkNamedLimit(sql, session.id);
        await sql.run(
          "INSERT INTO version_metadata(version_id,name,description,revision) VALUES($1,$2,$3,$4) ON CONFLICT(version_id) DO UPDATE SET name=excluded.name,description=excluded.description,revision=excluded.revision",
          [id, input.name, input.description, input.revision + 1],
        );
      });
      response.json({
        version: versionValue(await versionRow(id, session.id)),
      });
    },
  );
  app.delete(
    `${prefix}/versions/:versionId`,
    authenticated,
    async (request, response) => {
      const input = z
          .object({ version: expected, revision: expected.default(0) })
          .strict()
          .parse(request.body),
        { session } = await access(request, response, true),
        id = parameter(request, "versionId");
      await db.transaction(async (sql) => {
        await lock(sql, session, input.version);
        const row = await versionRow(id, session.id, sql);
        if ((row.revision ?? 0) !== input.revision) conflict();
        await sql.run("DELETE FROM versions WHERE id=$1 AND session_id=$2", [
          id,
          session.id,
        ]);
      });
      response.status(204).end();
    },
  );
  app.post(
    `${prefix}/versions/:versionId/restore`,
    authenticated,
    async (request, response) => {
      const input = z
        .object({
          version: expected,
          mode: z.enum(["replace", "copy"]).optional(),
          dayId: identifier.optional(),
          targetDayId: identifier.optional(),
        })
        .strict()
        .refine(
          (value) => value.dayId || (!value.mode && !value.targetDayId),
          "Choose a day when using a day restoration mode.",
        )
        .parse(request.body);
      const { session, role } = await access(request, response, true);
      if (session.version !== input.version) conflict();
      const source = JSON.parse(
        (await versionRow(parameter(request, "versionId"), session.id)).payload,
      ) as Session;
      let candidate = structuredClone(session);
      if (!input.dayId) {
        guardDay(session);
        const {
          id: _id,
          ownerId: _owner,
          createdAt: _created,
          updatedAt: _updated,
          version: _version,
          run: _run,
          ...editable
        } = source;
        candidate = { ...candidate, ...editableSessionSchema.parse(editable) };
        mergeDefinitions(candidate, session);
        candidate.pages?.forEach((page) => {
          if (
            session.pages?.find((current) => current.id === page.id)
              ?.visibility !== "public"
          )
            page.visibility = "team";
        });
      } else {
        const sourceDay = source.days.find((day) => day.id === input.dayId);
        if (!sourceDay) return missing();
        if (input.mode === "copy") {
          const copied = {
            ...structuredClone(sourceDay),
            id: randomUUID(),
            blocks: sourceDay.blocks.map(cloneBlockTree),
          };
          candidate.days.push(copied);
          candidate.contentOrder?.push({ kind: "day", id: copied.id });
        } else {
          const targetId = input.targetDayId ?? sourceDay.id,
            index = candidate.days.findIndex((day) => day.id === targetId);
          if (index < 0) return missing();
          guardDay(session, targetId);
          const outside = new Set(
            candidate.days
              .filter((day) => day.id !== targetId)
              .flatMap((day) =>
                allBlocks(day.blocks).flatMap((block) => [
                  block.id,
                  ...(block.rooms ?? []).map((room) => room.id),
                ]),
              ),
          );
          const blocks = sourceDay.blocks.map((block) =>
            allBlocks([block]).some(
              (item) =>
                outside.has(item.id) ||
                (item.rooms ?? []).some((room) => outside.has(room.id)),
            ) || targetId !== sourceDay.id
              ? cloneBlockTree(block)
              : structuredClone(block),
          );
          candidate.days[index] = {
            ...structuredClone(sourceDay),
            id: targetId,
            blocks,
          };
        }
        mergeDefinitions(candidate, source);
      }
      reconcileRun(session, candidate);
      response.json({
        session: await save(
          session,
          sessionInputSchema.parse(candidate),
          actor(response).id,
          input.mode === "copy" ? "Copied historical day" : "Restored version",
        ),
        role,
      });
    },
  );
  app.get(`${prefix}/journal`, authenticated, async (request, response) => {
    const { session } = await access(request, response),
      before = z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .parse(request.query.beforeVersion);
    const rows = await db.all<{
      id: string;
      author: string;
      createdAt: string;
      label: string;
      sessionVersion: number;
      payload: string;
    }>(
      'SELECT j.id,u.name AS author,j.created_at AS "createdAt",j.label,j.session_version AS "sessionVersion",j.payload FROM session_journal j JOIN users u ON u.id=j.user_id WHERE j.session_id=$1 AND j.session_version<$2 ORDER BY j.session_version DESC,j.id DESC LIMIT 101',
      [session.id, before ?? 2147483647],
    );
    const entries: JournalEntry[] = rows
      .slice(0, 100)
      .map(({ payload, ...row }) => ({ ...row, ...JSON.parse(payload) }));
    response.json({
      entries,
      nextBeforeVersion:
        rows.length > 100 ? entries.at(-1)!.sessionVersion : null,
    });
  });
  app.get(
    `${prefix}/deleted-elements`,
    authenticated,
    async (request, response) => {
      const { session } = await access(request, response),
        before = z.string().max(200).optional().parse(request.query.before);
      const rows = await db.all<TrashRow>(
        "SELECT d.id,d.kind,d.title,d.location,d.original_day_id,d.deleted_at,d.expires_at,u.name AS author FROM deleted_elements d JOIN users u ON u.id=d.user_id WHERE d.session_id=$1 AND d.restored_at IS NULL AND d.expires_at>$2 AND (d.deleted_at || d.id)<$3 ORDER BY d.deleted_at DESC,d.id DESC LIMIT 101",
        [session.id, new Date().toISOString(), before ?? "z"],
      );
      response.json({
        elements: rows.slice(0, 100).map(trashValue),
        nextBefore:
          rows.length > 100 ? rows[99].deleted_at + rows[99].id : null,
        retentionHours: 72,
      });
    },
  );
  app.post(
    `${prefix}/deleted-elements/:elementId/restore`,
    authenticated,
    async (request, response) => {
      const input = z
          .object({ version: expected, targetDayId: identifier.optional() })
          .strict()
          .parse(request.body),
        { session, role } = await access(request, response, true);
      if (session.version !== input.version) conflict();
      const [row] = await db.all<TrashRow>(
        "SELECT d.*,u.name AS author FROM deleted_elements d JOIN users u ON u.id=d.user_id WHERE d.id=$1 AND d.session_id=$2",
        [parameter(request, "elementId"), session.id],
      );
      if (!row) return missing();
      const now = new Date().toISOString();
      if (row.restored_at || row.expires_at <= now)
        return fail(
          410,
          "HISTORY_EXPIRED",
          "This item is already restored or its 72-hour retention has ended.",
        );
      const { element, columns, categories } = JSON.parse(
          row.payload,
        ) as TrashPayload,
        candidate = structuredClone(session);
      if (elements(candidate).has(element.id))
        return fail(
          409,
          "HISTORY_ALREADY_PRESENT",
          "This element already exists in the agenda.",
        );
      if (element.kind === "block") {
        const day = candidate.days.find(
          (day) => day.id === (input.targetDayId ?? element.dayId),
        );
        if (!day)
          return fail(
            409,
            "HISTORY_TARGET_REQUIRED",
            "Choose an existing day to restore this block.",
          );
        guardDay(session, day.id);
        const parent = allBlocks(day.blocks).find(
          (block) => block.id === element.parentId,
        );
        const destination =
          (day.id === element.dayId && parent
            ? element.roomId
              ? parent.rooms?.find((room) => room.id === element.roomId)?.blocks
              : parent.children
            : undefined) ?? day.blocks;
        destination.splice(
          Math.min(element.index, destination.length),
          0,
          recoveredBlocks([element.value as Block], session)[0],
        );
        mergeDefinitions(candidate, { columns, categories });
      } else if (element.kind === "day") {
        candidate.days.splice(
          Math.min(element.index, candidate.days.length),
          0,
          {
            ...structuredClone(element.value as Day),
            blocks: recoveredBlocks((element.value as Day).blocks, session),
          },
        );
        candidate.contentOrder?.push({ kind: "day", id: element.id });
        mergeDefinitions(candidate, { columns, categories });
      } else if (element.kind === "page") {
        (candidate.pages ??= []).splice(
          Math.min(element.index, candidate.pages?.length ?? 0),
          0,
          {
            ...structuredClone(element.value as SessionPage),
            visibility: "team",
          },
        );
        candidate.contentOrder?.push({ kind: "page", id: element.id });
      } else {
        (candidate.forms ??= []).splice(
          Math.min(element.index, candidate.forms?.length ?? 0),
          0,
          structuredClone(element.value as SessionForm),
        );
        candidate.contentOrder?.push({ kind: "form", id: element.id });
      }
      reconcileRun(session, candidate);
      response.json({
        session: await save(
          session,
          sessionInputSchema.parse(candidate),
          actor(response).id,
          "Restored deleted element",
          async (sql) => {
            const restoredAt = new Date().toISOString();
            if (
              !(await sql.run(
                "UPDATE deleted_elements SET restored_at=$1 WHERE id=$2 AND session_id=$3 AND restored_at IS NULL AND expires_at>$1",
                [restoredAt, row.id, session.id],
              ))
            )
              return fail(
                410,
                "HISTORY_EXPIRED",
                "This item is already restored or has expired.",
              );
          },
        ),
        role,
      });
    },
  );
}
