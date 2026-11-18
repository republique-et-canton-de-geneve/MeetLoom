import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { harness, origin, password } from "./support.js";
import { readConfig } from "../server/config.js";

const publicUrl = "https://tools.example.test/meetloom";
const publicHost = "tools.example.test";

/** Native HTTP preserves Host, unlike Node fetch's host normalization. The
 * path here is already stripped by the reverse proxy. */
async function publicRequest(
  base: string,
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest(
      `${base}${path}`,
      {
        method,
        headers: {
          Host: publicHost,
          Origin: new URL(publicUrl).origin,
          "Content-Type": "application/json",
          ...extra,
        },
      },
      (response) => {
        const parts: Buffer[] = [];
        response.on("data", (part) => parts.push(part));
        response.on("error", reject);
        response.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            for (const item of Array.isArray(value)
              ? value
              : value === undefined
                ? []
                : [value])
              headers.append(key, item);
          resolve(
            new Response(
              response.statusCode === 204 ? null : Buffer.concat(parts),
              { status: response.statusCode, headers },
            ),
          );
        });
      },
    );
    request.on("error", reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test("a trusted proxy URL selects public assets, CSRF origin and scoped cookies while native access keeps working", async (t) => {
  const clientPath = mkdtempSync(join(tmpdir(), "meetloom-public-"));
  writeFileSync(
    join(clientPath, "index.html"),
    '<!doctype html><head><script type="module" src="./assets/main.js"></script><link href="./assets/main.css" rel="stylesheet"></head>',
  );
  const h = await harness(t, {
    publicUrl,
    secureCookie: true,
    trustProxy: 1,
    clientPath,
  });
  const native = await fetch(`${h.base}/session/example`);
  assert.match(await native.text(), /content=""/);
  const proxied = await publicRequest(h.base, "/session/example");
  const html = await proxied.text();
  assert.match(html, /name="meetloom-base" content="\/meetloom"/);
  assert.match(html, /src="\/meetloom\/assets\/main.js"/);
  assert.match(html, /href="\/meetloom\/assets\/main.css"/);
  const explicitIndex = await publicRequest(h.base, "/index.html");
  assert.match(
    await explicitIndex.text(),
    /name="meetloom-base" content="\/meetloom"/,
  );
  const spoofed = await fetch(`${h.base}/`, {
    headers: {
      "X-Forwarded-Host": publicHost,
      "X-Forwarded-Prefix": "/attacker",
    },
  });
  assert.doesNotMatch(
    await spoofed.text(),
    /content="\/attacker"|content="\/meetloom"/,
  );
  const setup = await h.owner.request("/auth/setup", "POST", {
    name: "Owner",
    email: "owner@example.test",
    password,
    locale: "fr",
  });
  assert.equal(setup.status, 201);
  assert.match(
    setup.headers.get("set-cookie")!,
    /__Host-meetloom_session=.*Path=\//,
  );
  const login = await publicRequest(h.base, "/api/auth/login", "POST", {
    email: "owner@example.test",
    password,
  });
  assert.equal(login.status, 200, await login.text());
  assert.match(
    login.headers.get("set-cookie")!,
    /__Secure-meetloom_session=.*Path=\/meetloom\//,
  );
  const wrongOrigin = await publicRequest(
    h.base,
    "/api/auth/login",
    "POST",
    { email: "owner@example.test", password },
    { Origin: origin },
  );
  assert.equal(wrongOrigin.status, 403);
  const status = await publicRequest(
    h.base,
    "/api/auth/status",
    "GET",
    undefined,
    { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
  ).then((r) => r.json());
  assert.equal(status.user.email, "owner@example.test");
  const logout = await publicRequest(h.base, "/api/auth/logout", "POST", {});
  assert.match(
    logout.headers.get("set-cookie")!,
    /__Secure-meetloom_session=; Path=\/meetloom\//,
  );
});

test("alternate OIDC callbacks stay bound to the selected URL and SMTP links include its prefix", async (t) => {
  let authorize: { state: string; redirectUri: string } | undefined;
  const messages: string[] = [];
  const h = await harness(t, {
    publicUrl,
    oidc: {
      issuer: "https://identity.example.test",
      clientId: "meetloom",
      clientSecret: "test-only",
      accountPolicy: "existing",
    },
    oidcAdapter: {
      async authorize(input) {
        authorize = input;
        return `https://identity.example.test/start?state=${input.state}`;
      },
      async exchange(input) {
        assert.equal(
          input.url.origin + input.url.pathname,
          authorize!.redirectUri,
        );
        return {
          sub: "test-owner",
          email: "owner@example.test",
          email_verified: true,
        };
      },
    },
    mail: {
      host: "smtp.example.test",
      port: 587,
      secure: false,
      from: "meetloom@example.test",
      scheduled: false,
    },
    mailTransport: {
      async send(message) {
        messages.push(message.text);
      },
    },
  });
  await h.setup();
  const started = await publicRequest(
    h.base,
    "/api/auth/oidc/start",
    "POST",
    {},
  );
  assert.equal(started.status, 200);
  assert.equal(authorize!.redirectUri, `${publicUrl}/api/auth/oidc/callback`);
  const cookie = started.headers.get("set-cookie")!.split(";")[0];
  assert.match(started.headers.get("set-cookie")!, /Path=\/meetloom\//);
  const wrongHost = await fetch(
    `${h.base}/api/auth/oidc/callback?state=${authorize!.state}&code=test`,
    { headers: { Cookie: cookie }, redirect: "manual" },
  );
  assert.equal(wrongHost.headers.get("location"), "/?authError=OIDC_FAILED");
  const callback = await publicRequest(
    h.base,
    `/api/auth/oidc/callback?state=${authorize!.state}&code=test`,
    "GET",
    undefined,
    { Cookie: cookie },
  );
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("location"), "/meetloom/");
  const replay = await publicRequest(
    h.base,
    `/api/auth/oidc/callback?state=${authorize!.state}&code=test`,
    "GET",
    undefined,
    { Cookie: cookie },
  );
  assert.equal(
    replay.headers.get("location"),
    "/meetloom/?authError=OIDC_FAILED",
  );
  const invited = await h.owner.request("/auth/invites", "POST", {
    name: "Guest",
    email: "guest@example.test",
  });
  assert.equal(invited.status, 201);
  assert.ok(
    messages.some((text) =>
      text.includes(`${publicUrl}/join/${invited.body.token}`),
    ),
  );
  const mcp = await publicRequest(
    h.base,
    "/mcp",
    "POST",
    {},
    { Origin: "https://attacker.example.test" },
  );
  assert.equal(mcp.status, 403);
  const unsigned = await publicRequest(h.base, "/mcp", "POST", {});
  assert.equal(
    unsigned.status,
    401,
    "approved alternate host passes MCP host check before bearer authentication",
  );
});

test("proxy URL configuration accepts one explicit HTTP base and rejects unsafe or ambiguous values", () => {
  assert.equal(
    readConfig({ APP_PUBLIC_URL: publicUrl }).app.publicUrl,
    publicUrl,
  );
  assert.throws(
    () =>
      readConfig({ APP_ORIGIN: origin, APP_PUBLIC_URL: `${origin}/meetloom` }),
    /different host/,
  );
  assert.throws(
    () =>
      readConfig({
        NODE_ENV: "production",
        APP_ORIGIN: "https://native.example.test",
        APP_PUBLIC_URL: "http://tools.example.test/meetloom",
      }),
    /HTTPS/,
  );
  for (const value of [
    "//example.test/x",
    "https://a.test/x?y",
    "https://a.test/x#y",
    "https://user:password@a.test/x",
    "https://a.test/../x",
    "https://a.test/%2fother",
    "https://a.test/x\\other",
  ]) {
    assert.throws(
      () => readConfig({ APP_PUBLIC_URL: value }),
      /APP_PUBLIC_URL/,
    );
  }
});
