import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer, connect } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readConfig } from "../server/config.js";
import {
  MAX_AI_TIMEOUT_MS,
  REQUEST_RECEIVE_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
} from "../server/runtime-limits.js";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("deployment and installer budgets cover the supported request drain", async () => {
  assert.equal(
    readConfig({ AI_TIMEOUT_MS: String(MAX_AI_TIMEOUT_MS) }).app.ai?.timeoutMs,
    MAX_AI_TIMEOUT_MS,
  );
  assert.throws(() =>
    readConfig({ AI_TIMEOUT_MS: String(MAX_AI_TIMEOUT_MS + 1) }),
  );
  assert.ok(
    SHUTDOWN_TIMEOUT_MS >=
      REQUEST_RECEIVE_TIMEOUT_MS + MAX_AI_TIMEOUT_MS + 60000,
  );
  const manifest = await readFile(
    new URL("../k8s/base/application.yaml", import.meta.url),
    "utf8",
  );
  const grace = Number(
    manifest.match(/terminationGracePeriodSeconds: (\d+)/)?.[1],
  );
  const progress = Number(
    manifest.match(/progressDeadlineSeconds: (\d+)/)?.[1],
  );
  assert.match(manifest, /command: \["\/bin\/sh", "-c", "sleep 5"\]/);
  assert.ok(grace * 1000 > SHUTDOWN_TIMEOUT_MS + 5000);
  assert.ok(
    progress >= 2 * grace + 300,
    "two pods may each drain while new pods start",
  );
  const compose = await readFile(
    new URL("../compose.yaml", import.meta.url),
    "utf8",
  );
  assert.match(compose, new RegExp(`stop_grace_period: ${grace}s`));
  for (const extension of ["sh", "ps1"]) {
    const script = await readFile(
      new URL(`../scripts/deploy-openshift.${extension}`, import.meta.url),
      "utf8",
    );
    const timeout = Number(
      script.match(/rollout status deployment\/meetloom --timeout=(\d+)s/)?.[1],
    );
    assert.ok(
      timeout >= progress,
      "the installer must wait for the allowed rollout",
    );
  }
});

test(
  "SIGTERM preserves an active AI response past ten seconds and stops new connections",
  { skip: process.platform === "win32", timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "meetloom-shutdown-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let started!: () => void;
    const providerStarted = new Promise<void>((resolve) => (started = resolve));
    const provider = createServer(async (request, response) => {
      for await (const _part of request) {
        // Consume the synthetic request without logging prompts or credentials.
      }
      started();
      await pause(11500);
      response.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
      });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  blocks: [
                    {
                      title: "Synthetic agenda",
                      description: "Complete response",
                      duration: 60,
                      category: "discussion",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      provider.listen(0, "127.0.0.1", resolve),
    );
    const providerPort = (provider.address() as { port: number }).port;
    t.after(async () => {
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    });
    const reservation = createTcpServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve),
    );
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("../server/index.ts", import.meta.url)),
      ],
      {
        cwd: directory,
        stdio: "ignore",
        env: {
          ...process.env,
          NODE_ENV: "test",
          HOST: "127.0.0.1",
          PORT: String(port),
          APP_ORIGIN: base,
          APP_PUBLIC_URL: "",
          DATABASE_URL: "",
          SQLITE_PATH: join(directory, "fixture.sqlite"),
          BOOTSTRAP_TOKEN: "shutdown-fixture-bootstrap",
          COOKIE_SECURE: "false",
          BACKUP_SCHEDULER: "false",
          LLM_BASE_URL: `http://127.0.0.1:${providerPort}`,
          LLM_MODEL: "synthetic-provider",
          LLM_VISION_MODEL: "",
          LLM_API_KEY: "",
          LLM_ALLOW_SELF_SIGNED: "false",
          AI_TIMEOUT_MS: "300000",
          SMTP_HOST: "",
          SMTP_FROM: "",
          OIDC_ISSUER: "",
          OIDC_CLIENT_ID: "",
          OIDC_CLIENT_SECRET: "",
        },
      },
    );
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null) child.kill("SIGKILL");
      await exited;
    });
    let ready = false;
    for (let attempt = 0; attempt < 400 && child.exitCode === null; attempt++) {
      try {
        ready = (await fetch(base + "/api/ready")).ok;
      } catch {
        // Wait only for this disposable process, never a real application.
      }
      if (ready) break;
      await pause(25);
    }
    assert.ok(ready, "the isolated application started");
    const setup = await fetch(base + "/api/auth/setup", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Fixture",
        email: "shutdown@example.test",
        password: "synthetic-shutdown-password-2026",
        locale: "en",
        bootstrapToken: "shutdown-fixture-bootstrap",
      }),
    });
    assert.equal(setup.status, 201);
    await setup.json();
    const cookie = setup.headers.get("set-cookie")!.split(";")[0];
    const pending = fetch(base + "/api/ai/generate", {
      method: "POST",
      headers: {
        Origin: base,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Generate a synthetic agenda",
        duration: 60,
        locale: "en",
      }),
    });
    // The previous implementation rejects here when it cuts the connection.
    pending.catch(() => {});
    await providerStarted;
    child.kill("SIGTERM");
    let refused = false;
    const stopDeadline = Date.now() + 2000;
    while (Date.now() < stopDeadline) {
      refused = await new Promise<boolean>((resolve, reject) => {
        const socket = connect(port, "127.0.0.1");
        socket.once("connect", () => {
          socket.destroy();
          resolve(false);
        });
        socket.once("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "ECONNREFUSED") resolve(true);
          // A connection racing the listener's close can be reset first.
          // Keep polling until refusal proves the listener has stopped.
          else if (error.code === "ECONNRESET") resolve(false);
          else reject(error);
        });
        socket.setTimeout(250, () => {
          socket.destroy();
          resolve(false);
        });
      });
      if (refused) break;
      await pause(25);
    }
    assert.ok(refused, "the draining process stops accepting new connections");
    const response = await pending;
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0].title, "Synthetic agenda");
    assert.equal(result.blocks[0].description, "Complete response");
    assert.equal(result.blocks[0].duration, 60);
    assert.deepEqual(await exited, [0, null]);
  },
);
