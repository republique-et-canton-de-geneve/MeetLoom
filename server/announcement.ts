import type { Express, RequestHandler } from "express";
import { z } from "zod";
import type { Database } from "./db.js";
import { audit } from "./audit.js";

export interface Announcement {
  message: string;
  tone: "info" | "warning";
  updatedAt: string;
}

/**
 * A message from the administrators shown at the top of every page for
 * accounts, sign-in included (a maintenance window, a new feature). Empty
 * means no banner. It is public: never put anything confidential in it.
 */
export function registerAnnouncement(
  app: Express,
  { db, admin }: { db: Database; admin: RequestHandler },
) {
  app.get("/api/announcement", async (_request, response) => {
    const [row] = await db.all<{ payload: string }>(
      "SELECT payload FROM app_settings WHERE id='announcement'",
    );
    response.setHeader("Cache-Control", "no-store");
    response.json({
      announcement: row ? (JSON.parse(row.payload) as Announcement) : null,
    });
  });
  app.put("/api/admin/announcement", admin, async (request, response) => {
    const input = z
      .object({
        message: z.string().trim().max(500),
        tone: z.enum(["info", "warning"]).default("info"),
      })
      .strict()
      .parse(request.body);
    const announcement: Announcement | null = input.message
      ? { ...input, updatedAt: new Date().toISOString() }
      : null;
    await db.transaction(async (sql) => {
      if (announcement)
        await sql.run(
          "INSERT INTO app_settings(id,payload) VALUES('announcement',$1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
          [JSON.stringify(announcement)],
        );
      else await sql.run("DELETE FROM app_settings WHERE id='announcement'");
      await audit(sql, request, response, "settings.announcement", {
        detail: { tone: input.tone, length: input.message.length },
      });
    });
    response.json({ announcement });
  });
}
