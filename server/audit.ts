import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { Sql } from "./db.js";

/** Privileged actions recorded in `audit_events`. A closed set: a misspelt
 * name would write a row nobody ever finds, so unknown names are refused. */
export const AUDIT_ACTIONS = [
  "installation.setup",
  "settings.signup",
  "settings.sound",
  "settings.announcement",
  "account.invite",
  "account.update",
  "account.access-revoke",
  "account.reset",
  "settings.backups",
  "backup.create",
  "backup.delete",
  "backup.download",
  "backup.restore",
  "backup.restore-session",
  "data.export",
  "data.import",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Rows are kept this long, then pruned when new events are written. */
const AUDIT_RETENTION_DAYS = 400;

/**
 * Appends one audit row inside the caller's transaction, so the action and
 * its record commit or roll back together. Takes the request first: the
 * client address is part of every row and cannot be forgotten. Never pass
 * secrets (tokens, passwords) in `detail`.
 */
export async function audit(
  sql: Sql,
  request: Request,
  response: Response,
  action: AuditAction,
  {
    target = null,
    detail = {},
    actorId,
  }: {
    target?: string | null;
    detail?: Record<string, string | number | boolean | null>;
    /** Only when the actor is not yet signed in (first administrator). */
    actorId?: string;
  } = {},
): Promise<void> {
  if (!AUDIT_ACTIONS.includes(action))
    throw new Error(`Unknown audit action: ${String(action)}`);
  const now = new Date();
  const actor =
    actorId ?? (response.locals.user as { id?: string } | undefined)?.id;
  await sql.run(
    "INSERT INTO audit_events(id,at,action,actor_id,target,detail,ip) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      now.toISOString(),
      action,
      actor ?? null,
      target,
      JSON.stringify(detail),
      request.ip ?? null,
    ],
  );
  await sql.run("DELETE FROM audit_events WHERE at < $1", [
    new Date(
      now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  ]);
}
