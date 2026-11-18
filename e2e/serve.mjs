// Starts the built application on a fresh, disposable SQLite database.
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { createApp } from "../dist/server/app.js";
import { readConfig } from "../dist/server/config.js";
import { log } from "../dist/server/log.js";

const directory = resolve(".e2e");
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const port = process.env.E2E_PORT ?? "3210";
Object.assign(process.env, {
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  PORT: port,
  APP_ORIGIN: `http://127.0.0.1:${port}`,
  APP_PUBLIC_URL: `http://localhost:${port}/meetloom`,
  SQLITE_PATH: resolve(directory, "meetloom.sqlite"),
  COOKIE_SECURE: "false",
});
// Models a proxy that preserves the external Host and strips its mount path.
const runtime = await createApp(readConfig().app);
createServer((request, response) => {
  if (request.headers.host === `localhost:${port}`) {
    if (!/^\/meetloom(?:\/|\?|$)/.test(request.url ?? "")) {
      response.writeHead(404).end();
      return;
    }
    request.url = request.url.slice("/meetloom".length) || "/";
    if (request.url.startsWith("?")) request.url = `/${request.url}`;
  }
  runtime.app(request, response);
}).listen(Number(port), "0.0.0.0", () =>
  log.info("MeetLoom listening", { port: Number(port) }),
);
