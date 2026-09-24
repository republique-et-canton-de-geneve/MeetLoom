// Starts the built application on a fresh, disposable SQLite database.
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(".e2e");
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const port = process.env.E2E_PORT ?? "3210";
Object.assign(process.env, {
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  PORT: port,
  APP_ORIGIN: `http://127.0.0.1:${port}`,
  SQLITE_PATH: resolve(directory, "meetloom.sqlite"),
  COOKIE_SECURE: "false",
});
await import("../dist/server/index.js");
