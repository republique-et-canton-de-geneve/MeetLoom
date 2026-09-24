import type { Express, Response } from "express";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import type { Session, Role, User } from "../shared/model.js";
import { INITIAL_RUN } from "../shared/model.js";
import { allBlocks, createSession } from "../shared/domain.js";
import {
  copyAgendaContent,
  removeTransferredContent,
  transferSource,
} from "../shared/transfers.js";
import { fail } from "./security.js";
import { storedSession, accessibleSessionRows } from "./workspaces.js";
import { guardSessionLifecycle } from "./lifecycle.js";
import { recordSessionFolders } from "./folders.js";
import { sessionInputSchema } from "../shared/validation.js";
const id = z.string().min(1).max(120);
type Save = (
  previous: Session,
  candidate: Session,
  author: string,
  label?: string,
  commit?: (sql: Sql, next: Session) => Promise<void>,
  transaction?: Sql,
) => Promise<Session>;
export function installTransfersApi(
  app: Express,
  {
    db,
    accessible,
    save,
  }: {
    db: Database;
    accessible: (
      id: string,
      userId: string,
      roles?: Role[],
    ) => Promise<{ session: Session; role: Role }>;
    save: Save;
  },
) {
  app.post("/api/sessions/:id/transfer", async (req, res: Response) => {
    const user = res.locals.user as User,
      input = z
        .object({
          sourceVersion: z.number().int().positive(),
          dayIds: z.array(id).min(1).max(30),
          blockIds: z.array(id).min(1).max(1000).optional(),
          destinationId: id.optional(),
          destinationVersion: z.number().int().positive().optional(),
          destinationDayId: id.optional(),
          destinationBeforeBlockId: id.optional(),
          newTitle: z.string().trim().min(1).max(200).optional(),
          mode: z.enum(["copy", "move"]).default("copy"),
        })
        .strict()
        .parse(req.body);
    if (input.destinationId === req.params.id)
      return fail(
        400,
        "SAME_SESSION",
        "Use the day controls to move blocks inside this session.",
      );
    const source = await accessible(
      id.parse(req.params.id),
      user.id,
      input.mode === "move" ? ["owner", "editor"] : undefined,
    );
    if (source.session.version !== input.sourceVersion)
      return fail(
        409,
        "VERSION_CONFLICT",
        "The source agenda changed. Reload before transferring.",
      );
    if (
      input.dayIds.some(
        (dayId) => !source.session.days.some((day) => day.id === dayId),
      )
    )
      return fail(400, "INVALID_DAY", "Source day not found.");
    const sourceIds = new Set(
      source.session.days
        .filter((day) => input.dayIds.includes(day.id))
        .flatMap((day) => allBlocks(day.blocks).map((block) => block.id)),
    );
    if (input.blockIds?.some((blockId) => !sourceIds.has(blockId)))
      return fail(400, "INVALID_BLOCK", "Source block not found.");
    const incoming = transferSource(
      source.session,
      input.dayIds,
      input.blockIds,
    );
    if (
      input.mode === "move" &&
      ["running", "paused"].includes(source.session.run.status) &&
      incoming.days.some(
        (day) =>
          (!input.blockIds && day.id === source.session.run.dayId) ||
          allBlocks(day.blocks).some(
            (block) => block.id === source.session.run.blockId,
          ),
      )
    )
      return fail(
        409,
        "ACTIVE_BLOCK_REMOVED",
        "Stop the timer before moving its active day or block.",
      );
    if (
      input.mode === "move" &&
      !input.blockIds &&
      source.session.days.length === incoming.days.length
    )
      return fail(
        400,
        "LAST_DAY",
        "Keep at least one day in the source agenda.",
      );
    let destination: Session;
    if (input.destinationId) {
      destination = (
        await accessible(input.destinationId, user.id, ["owner", "editor"])
      ).session;
      if (destination.version !== input.destinationVersion)
        return fail(
          409,
          "VERSION_CONFLICT",
          "The destination agenda changed. Reload before transferring.",
        );
    } else {
      if (!input.newTitle)
        return fail(
          400,
          "VALIDATION_ERROR",
          "Give the extracted session a title.",
        );
      destination = createSession(user.id, input.newTitle, user.locale, false);
      destination.columns = destination.columns.filter((column) =>
        ["description", "facilitator"].includes(column.id),
      );
      destination.editorLayout = source.session.editorLayout;
    }
    if (
      input.destinationDayId &&
      !destination.days.some((day) => day.id === input.destinationDayId)
    )
      return fail(400, "INVALID_DAY", "Destination day not found.");
    if (
      input.destinationBeforeBlockId &&
      !destination.days
        .find((day) => day.id === input.destinationDayId)
        ?.blocks.some((block) => block.id === input.destinationBeforeBlockId)
    )
      return fail(
        400,
        "INVALID_BLOCK",
        "The insertion point does not belong to the destination day.",
      );
    let copied: Session;
    try {
      copied = copyAgendaContent(
        destination,
        incoming,
        input.destinationDayId,
        input.destinationBeforeBlockId,
      );
      if (!input.destinationId)
        copied = sessionInputSchema.parse({
          ...copied,
          days: copied.days.slice(1),
          run: { ...INITIAL_RUN, dayId: copied.days[1].id },
          contentOrder: copied.contentOrder?.filter(
            (item) => item.id !== destination.days[0].id,
          ),
        });
    } catch {
      return fail(
        400,
        "IMPORT_LIMIT",
        "This transfer exceeds the agenda limits. Reduce the selected content.",
      );
    }
    const nextSource =
      input.mode === "move"
        ? removeTransferredContent(source.session, input.dayIds, input.blockIds)
        : source.session;
    const result = await db.transaction(async (sql) => {
      // Consistent lock order prevents opposite moves from deadlocking on PostgreSQL.
      for (const sessionId of [
        source.session.id,
        ...(input.destinationId ? [input.destinationId] : []),
      ].sort())
        await sql.run("UPDATE sessions SET version=version WHERE id=$1", [
          sessionId,
        ]);
      const [active] = await sql.all(
        "SELECT id FROM users WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
        [user.id],
      );
      if (!active) return fail(403, "FORBIDDEN", "Account access was revoked.");
      const [sourceAccess] = await accessibleSessionRows(
        sql,
        user.id,
        source.session.id,
      );
      if (!sourceAccess)
        return fail(
          404,
          "NOT_FOUND",
          "Source session is no longer accessible.",
        );
      if (
        input.mode === "move" &&
        !["owner", "editor"].includes(sourceAccess.role)
      )
        return fail(403, "FORBIDDEN", "Source editing access was revoked.");
      await guardSessionLifecycle(sql, source.session.id, {
        write: input.mode === "move",
      });
      if (input.destinationId) {
        const [destinationAccess] = await accessibleSessionRows(
          sql,
          user.id,
          input.destinationId,
        );
        if (
          !destinationAccess ||
          !["owner", "editor"].includes(destinationAccess.role)
        )
          return fail(
            403,
            "FORBIDDEN",
            "Destination editing access was revoked.",
          );
      }
      const [current] = await sql.all<{ version: number }>(
        "SELECT version FROM sessions WHERE id=$1",
        [source.session.id],
      );
      if (current.version !== input.sourceVersion)
        return fail(
          409,
          "VERSION_CONFLICT",
          "The source agenda changed. Retry.",
        );
      const finalSource =
        input.mode === "move"
          ? await save(
              source.session,
              nextSource,
              user.id,
              "Moved agenda content",
              undefined,
              sql,
            )
          : source.session;
      let finalDestination: Session;
      if (input.destinationId)
        finalDestination = await save(
          destination,
          copied,
          user.id,
          "Imported agenda content",
          undefined,
          sql,
        );
      else {
        finalDestination = copied;
        await recordSessionFolders(sql, undefined, copied);
        await sql.run(
          "INSERT INTO sessions(id,owner_id,payload,version,updated_at) VALUES($1,$2,$3,$4,$5)",
          [
            copied.id,
            copied.ownerId,
            storedSession(copied),
            copied.version,
            copied.updatedAt,
          ],
        );
      }
      return { source: finalSource, destination: finalDestination };
    });
    res.json(result);
  });
}
