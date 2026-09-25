import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { createApp, type AppConfig } from "../server/app.js";
import type { Session } from "../shared/model.js";
export const origin = "http://meetloom.test";
export const password = "correct-horse-battery-123";
export async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
export async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
export async function harness(t: TestContext, config: AppConfig = {}) {
  const postgresUrl = config.databaseUrl ?? process.env.TEST_DATABASE_URL;
  let isolatedDatabaseUrl: string | undefined;
  let schemaPool: Pool | undefined;
  const testSchema = `meetloom_test_${randomUUID().replaceAll("-", "")}`;
  if (postgresUrl) {
    schemaPool = new Pool({ connectionString: postgresUrl, max: 1 });
    // A unique generated schema lets the same behavioral suite exercise PostgreSQL
    // without modifying existing application tables or other concurrent test runs.
    await schemaPool.query(`CREATE SCHEMA "${testSchema}"`);
    const url = new URL(postgresUrl);
    url.searchParams.set("options", `-c search_path=${testSchema}`);
    isolatedDatabaseUrl = url.href;
  }
  const cleanupSchema = async () => {
    if (schemaPool) {
      try {
        await schemaPool.query(`DROP SCHEMA "${testSchema}" CASCADE`);
      } finally {
        await schemaPool.end();
      }
    }
  };
  let runtime: Awaited<ReturnType<typeof createApp>>;
  try {
    runtime = await createApp({
      sqlitePath: ":memory:",
      origin,
      rateLimits: false,
      ...config,
      databaseUrl: isolatedDatabaseUrl,
    });
  } catch (error) {
    await cleanupSchema();
    throw error;
  }
  const server = createServer(runtime.app);
  const base = await listen(server);
  t.after(async () => {
    try {
      await stop(server);
      await runtime.close();
    } finally {
      await cleanupSchema();
    }
  });
  function client() {
    let cookie = "";
    return {
      /** The raw response, for binary downloads. */
      async raw(path: string, method = "GET", body?: unknown) {
        const response = await fetch(`${base}/api${path}`, {
          method,
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = response.headers.get("set-cookie");
        if (setCookie) cookie = setCookie.split(";")[0];
        return response;
      },
      async request(
        path: string,
        method = "GET",
        body?: unknown,
        override: Record<string, string | null> = {},
      ) {
        const headers: Record<string, string> = {
          Origin: origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        };
        for (const [key, value] of Object.entries(override)) {
          if (value === null) delete headers[key];
          else headers[key] = value;
        }
        const response = await fetch(`${base}/api${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = response.headers.get("set-cookie");
        if (setCookie) cookie = setCookie.split(";")[0];
        return {
          status: response.status,
          body: (response.status === 204
            ? undefined
            : await response.json()) as any,
          headers: response.headers,
        };
      },
    };
  }
  const owner = client();
  async function setup() {
    const result = await owner.request("/auth/setup", "POST", {
      name: "Owner",
      email: "owner@example.test",
      password,
      locale: "fr",
      bootstrapToken: config.bootstrapToken,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.user;
  }
  async function account(email: string) {
    const invited = await owner.request("/auth/invites", "POST", {
      name: email,
      email,
    });
    assert.equal(invited.status, 201);
    const guest = client();
    const accepted = await guest.request("/auth/accept-invite", "POST", {
      name: email,
      token: invited.body.token,
      password,
      locale: "en",
    });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
    return { client: guest, user: accepted.body.user };
  }
  async function session() {
    const created = await owner.request("/sessions", "POST", {
      title: "Workshop",
      locale: "fr",
      demo: true,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body.session as Session;
  }
  return { ...runtime, base, client, owner, setup, account, session };
}
