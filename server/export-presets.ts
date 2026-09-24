import type { Express, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { printOptionsSchema } from "../shared/export-settings.js";
import type { Database } from "./db.js";
import type { User } from "../shared/model.js";
import { fail } from "./security.js";
export async function installExportPresets(
  app: Express,
  { db, authenticated }: { db: Database; authenticated: RequestHandler },
) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS export_presets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,payload TEXT NOT NULL)",
  );
  app.get("/api/export/presets", authenticated, async (_req, res) => {
    const rows = await db.all<{ id: string; name: string; payload: string }>(
      "SELECT id,name,payload FROM export_presets WHERE user_id=$1 ORDER BY name",
      [(res.locals.user as User).id],
    );
    res.json({
      presets: rows.map((row) => ({
        id: row.id,
        name: row.name,
        ...JSON.parse(row.payload),
      })),
    });
  });
  app.post("/api/export/presets", authenticated, async (req, res) => {
    const value = z
        .object({
          name: z.string().trim().min(1).max(120),
          audience: z.enum(["team", "public"]),
          options: printOptionsSchema,
        })
        .strict()
        .parse(req.body),
      userId = (res.locals.user as User).id;
    const [count] = await db.all<{ total: number | string }>(
      "SELECT COUNT(*) AS total FROM export_presets WHERE user_id=$1",
      [userId],
    );
    if (Number(count.total) >= 20)
      return fail(
        400,
        "EXPORT_PRESET_LIMIT",
        "Delete a preset before creating another.",
      );
    const id = randomUUID();
    await db.run(
      "INSERT INTO export_presets(id,user_id,name,payload) VALUES($1,$2,$3,$4)",
      [
        id,
        userId,
        value.name,
        JSON.stringify({ audience: value.audience, options: value.options }),
      ],
    );
    res.status(201).json({ preset: { id, ...value } });
  });
  app.put("/api/export/presets/:id", authenticated, async (req, res) => {
    const value = z
      .object({
        name: z.string().trim().min(1).max(120),
        audience: z.enum(["team", "public"]),
        options: printOptionsSchema,
      })
      .strict()
      .parse(req.body);
    const id = z.string().max(120).parse(req.params.id),
      userId = (res.locals.user as User).id;
    const changed = await db.run(
      "UPDATE export_presets SET name=$1,payload=$2 WHERE id=$3 AND user_id=$4",
      [
        value.name,
        JSON.stringify({ audience: value.audience, options: value.options }),
        id,
        userId,
      ],
    );
    if (!changed) return fail(404, "NOT_FOUND", "This preset is unavailable.");
    res.json({ preset: { id, ...value } });
  });
  app.delete("/api/export/presets/:id", authenticated, async (req, res) => {
    await db.run("DELETE FROM export_presets WHERE id=$1 AND user_id=$2", [
      z.string().max(120).parse(req.params.id),
      (res.locals.user as User).id,
    ]);
    res.status(204).end();
  });
}
