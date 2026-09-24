import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { harness, origin, password } from "./support.js";
import type { OidcAdapter, OidcClaims, OidcConfig } from "../server/oidc.js";
import type { MailConfig, MailMessage } from "../server/mailer.js";
import { DEFAULT_ACCOUNT_PREFERENCES } from "../shared/accounts.js";
import { readConfig } from "../server/config.js";
import { hashToken } from "../server/security.js";

const oidc: OidcConfig = {
  issuer: "https://identity.example.test/realm",
  clientId: "meetloom",
  clientSecret: "server-only-secret",
  accountPolicy: "existing",
};
const mail: MailConfig = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  from: "meetloom@example.test",
  scheduled: false,
};
function provider() {
  let claims: OidcClaims = {
      sub: "subject-1",
      email: "owner@example.test",
      email_verified: true,
      name: "Provider owner",
    },
    exchanges = 0;
  const requests = new Map<string, Parameters<OidcAdapter["authorize"]>[0]>();
  const adapter: OidcAdapter = {
    async authorize(input) {
      requests.set(input.state, input);
      const url = new URL("https://identity.example.test/authorize");
      url.searchParams.set("state", input.state);
      return url.href;
    },
    async exchange(input) {
      const request = requests.get(input.state);
      assert.ok(request);
      assert.equal(input.nonce, request.nonce);
      assert.equal(input.verifier, request.verifier);
      assert.equal(input.url.origin, origin);
      assert.equal(input.url.pathname, "/api/auth/oidc/callback");
      exchanges++;
      return { ...claims };
    },
  };
  return {
    adapter,
    requests,
    get exchanges() {
      return exchanges;
    },
    set(value: OidcClaims) {
      claims = value;
    },
  };
}
async function begin(h: Awaited<ReturnType<typeof harness>>) {
  const result = await h.client().request("/auth/oidc/start", "POST", {});
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const state = new URL(result.body.url).searchParams.get("state")!,
    cookie = result.headers.get("set-cookie")!.split(";")[0];
  return { state, cookie };
}
async function callback(
  h: Awaited<ReturnType<typeof harness>>,
  flow: { state: string; cookie: string },
  cookie = flow.cookie,
) {
  return fetch(
    `${h.base}/api/auth/oidc/callback?state=${flow.state}&code=test-code`,
    { headers: { Cookie: cookie }, redirect: "manual" },
  );
}
function authCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .find((value) => /^meetloom_session=/.test(value))
    ?.split(";")[0];
}

test("OIDC binds a verified existing account, consumes browser-bound flows once, and never exposes provider secrets", async (t) => {
  const p = provider(),
    h = await harness(t, { oidc, oidcAdapter: p.adapter });
  const owner = await h.setup();
  const status = (await h.client().request("/auth/status")).body;
  assert.equal(status.oidcEnabled, true);
  assert.equal(JSON.stringify(status).includes("server-only-secret"), false);
  const flow = await begin(h),
    [stored] = await h.db.all<any>("SELECT * FROM oidc_flows");
  assert.equal(stored.state_hash, hashToken(flow.state));
  assert.equal(stored.binding_hash, hashToken(flow.cookie.split("=")[1]));
  assert.equal(JSON.stringify(stored).includes(flow.state), false);
  const rejected = await callback(h, flow, "meetloom_oidc=wrong");
  assert.equal(rejected.headers.get("location"), "/?authError=OIDC_FAILED");
  assert.equal(p.exchanges, 0);
  const accepted = await callback(h, flow);
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get("location"), "/");
  assert.ok(authCookie(accepted));
  assert.equal(p.exchanges, 1);
  const account = await fetch(`${h.base}/api/auth/status`, {
    headers: { Cookie: authCookie(accepted)! },
  }).then((response) => response.json());
  assert.equal(account.user.id, owner.id);
  const replay = await callback(h, flow);
  assert.equal(replay.headers.get("location"), "/?authError=OIDC_FAILED");
  assert.equal(authCookie(replay), undefined);
  assert.equal(p.exchanges, 1);
  assert.equal((await h.db.all("SELECT * FROM oidc_flows")).length, 0);
});

test("OIDC rejects unverified/unknown identities, recycled subjects, expired state and disabled accounts", async (t) => {
  const p = provider(),
    h = await harness(t, { oidc, oidcAdapter: p.adapter });
  await h.setup();
  p.set({
    sub: "unverified",
    email: "owner@example.test",
    email_verified: false,
  });
  assert.equal(
    (await callback(h, await begin(h))).headers.get("location"),
    "/?authError=OIDC_FAILED",
  );
  assert.equal((await h.db.all("SELECT * FROM oidc_identities")).length, 0);
  p.set({
    sub: "unknown",
    email: "unknown@example.test",
    email_verified: true,
  });
  assert.equal(
    (await callback(h, await begin(h))).headers.get("location"),
    "/?authError=OIDC_FAILED",
  );
  assert.equal((await h.db.all("SELECT * FROM users")).length, 1);
  const expired = await begin(h);
  await h.db.run("UPDATE oidc_flows SET expires_at=0");
  const calls = p.exchanges;
  assert.equal(
    (await callback(h, expired)).headers.get("location"),
    "/?authError=OIDC_FAILED",
  );
  assert.equal(p.exchanges, calls);
  p.set({ sub: "stable", email: "owner@example.test", email_verified: true });
  assert.equal(
    (await callback(h, await begin(h))).headers.get("location"),
    "/",
  );
  p.set({ sub: "recycled", email: "owner@example.test", email_verified: true });
  assert.equal(
    (await callback(h, await begin(h))).headers.get("location"),
    "/?authError=OIDC_FAILED",
  );
  const member = await h.account("member@example.test");
  await h.owner.request(`/admin/accounts/${member.user.id}`, "PATCH", {
    disabled: true,
  });
  p.set({ sub: "disabled", email: member.user.email, email_verified: true });
  assert.equal(
    (await callback(h, await begin(h))).headers.get("location"),
    "/?authError=OIDC_FAILED",
  );
});

test("OIDC invited policy consumes workspace invitation atomically and creates only a non-admin account", async (t) => {
  const p = provider(),
    h = await harness(t, {
      oidc: { ...oidc, accountPolicy: "invited" },
      oidcAdapter: p.adapter,
    });
  await h.setup();
  const workspace = (
    await h.owner.request("/workspaces", "POST", { name: "Organisation" })
  ).body.workspace;
  const invitation = await h.owner.request(
    `/workspaces/${workspace.id}/members`,
    "POST",
    { email: "invited@example.test", name: "Invited", role: "editor" },
  );
  assert.equal(invitation.status, 201, JSON.stringify(invitation.body));
  p.set({
    sub: "invited-subject",
    email: "invited@example.test",
    email_verified: true,
    name: "Invited",
  });
  const result = await callback(h, await begin(h));
  assert.equal(result.headers.get("location"), "/");
  const [user] = await h.db.all<any>("SELECT * FROM users WHERE email=$1", [
    "invited@example.test",
  ]);
  assert.equal(user.is_admin, 0);
  const [membership] = await h.db.all<any>(
    "SELECT * FROM workspace_members WHERE user_id=$1",
    [user.id],
  );
  assert.equal(membership.workspace_id, workspace.id);
  assert.equal(membership.role, "editor");
  assert.equal(
    (
      await h.db.all("SELECT * FROM invites WHERE email=$1", [
        "invited@example.test",
      ])
    ).length,
    0,
  );
});

test("SMTP recovery is non-enumerating, rate-limited per address, hash-only and single-use with a mock transport", async (t) => {
  const messages: MailMessage[] = [],
    h = await harness(t, {
      mail,
      mailTransport: {
        async send(message) {
          messages.push(message);
        },
      },
    });
  const owner = await h.setup();
  assert.equal(
    (await h.client().request("/auth/status")).body.passwordResetEnabled,
    true,
  );
  const known = await h
      .client()
      .request("/auth/forgot-password", "POST", { email: owner.email }),
    unknown = await h.client().request("/auth/forgot-password", "POST", {
      email: "unknown@example.test",
    });
  assert.equal(known.status, 202);
  assert.deepEqual(known.body, unknown.body);
  await h.mail.flush();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, owner.email);
  const raw = messages[0].text.match(/\/recover\/([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(raw);
  const [stored] = await h.db.all<any>("SELECT * FROM account_resets");
  assert.equal(stored.token_hash, hashToken(raw));
  assert.equal(JSON.stringify(stored).includes(raw), false);
  await h
    .client()
    .request("/auth/forgot-password", "POST", { email: owner.email });
  await h.mail.flush();
  assert.equal(messages.length, 1);
  const reset = await h.client().request("/auth/reset-password", "POST", {
    token: raw,
    password: "changed-password-with-enough-entropy",
  });
  assert.equal(reset.status, 200);
  assert.equal(
    (
      await h
        .client()
        .request("/auth/reset-password", "POST", { token: raw, password })
    ).status,
    400,
  );
  assert.equal((await h.owner.request("/account")).status, 401);
});

test("SMTP failures disclose no transport details and invalidate undelivered recovery links", async (t) => {
  const h = await harness(t, {
    mail,
    mailTransport: {
      async send() {
        throw new Error("Secret SMTP detail");
      },
    },
  });
  const owner = await h.setup();
  const result = await h
    .client()
    .request("/auth/forgot-password", "POST", { email: owner.email });
  assert.equal(result.status, 202);
  assert.deepEqual(result.body, { ok: true });
  await h.mail.flush();
  assert.equal((await h.db.all("SELECT * FROM account_resets")).length, 0);
});

test("scheduled mail is opt-in, deduplicated, scoped to current access and owner/editor reminders", async (t) => {
  const messages: MailMessage[] = [],
    h = await harness(t, {
      mail,
      mailTransport: {
        async send(message) {
          messages.push(message);
        },
      },
    });
  const owner = await h.setup(),
    member = await h.account("member@example.test"),
    viewer = await h.account("viewer@example.test");
  let session = await h.session();
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: member.user.email,
    role: "editor",
  });
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  const now = Date.parse("2026-11-03T10:15:00Z");
  session.days[0].date = "2026-11-06";
  session.days = session.days.slice(0, 1);
  const saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200);
  session = saved.body.session;
  for (const person of [owner, member.user, viewer.user])
    await h.db.run(
      "INSERT INTO account_profiles(user_id,payload) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload",
      [
        person.id,
        JSON.stringify({
          preferences: {
            ...DEFAULT_ACCOUNT_PREFERENCES,
            emailDigest: true,
            emailReminder: true,
          },
        }),
      ],
    );
  const comment = await h.owner.request(
    `/sessions/${session.id}/comments`,
    "POST",
    { text: "Private planning note" },
  );
  assert.equal(comment.status, 201);
  await h.db.run("UPDATE notifications SET created_at=$1", [
    new Date(now - 60 * 60 * 1000).toISOString(),
  ]);
  await h.mail.scheduled(now);
  assert.equal(
    messages.filter((message) => /three days|trois jours/.test(message.subject))
      .length,
    2,
  );
  assert.ok(messages.some((message) => message.to === owner.email));
  assert.ok(messages.some((message) => message.to === member.user.email));
  assert.equal(
    messages.filter(
      (message) =>
        message.to === viewer.user.email &&
        /three days|trois jours/.test(message.subject),
    ).length,
    0,
  );
  assert.equal(
    messages.filter((message) => message.subject.includes("new discussions"))
      .length,
    2,
  );
  assert.equal(
    messages.some((message) => message.text.includes("Private planning note")),
    false,
  );
  assert.ok(messages.every((message) => !message.text.includes("/s/")));
  const count = messages.length;
  await h.mail.scheduled(now + 60000);
  assert.equal(messages.length, count);
  await h.owner.request(
    `/sessions/${session.id}/members/${viewer.user.id}`,
    "DELETE",
    {},
  );
  await h.db.run("UPDATE notifications SET created_at=$1,read_at=NULL", [
    new Date(now + 60 * 60 * 1000).toISOString(),
  ]);
  await h.mail.scheduled(now + 2 * 60 * 60 * 1000);
  assert.equal(
    messages.slice(count).some((message) => message.to === viewer.user.email),
    false,
  );
});

test("production origin falls back to Render's public URL unless APP_ORIGIN is set", () => {
  const render = "https://meetloom-demo.onrender.com";
  assert.throws(() => readConfig({ NODE_ENV: "production" }), /APP_ORIGIN/);
  assert.equal(
    readConfig({ NODE_ENV: "production", RENDER_EXTERNAL_URL: render }).app
      .origin,
    render,
  );
  assert.equal(
    readConfig({
      NODE_ENV: "production",
      APP_ORIGIN: "",
      RENDER_EXTERNAL_URL: render,
    }).app.origin,
    render,
  );
  assert.equal(
    readConfig({
      NODE_ENV: "production",
      APP_ORIGIN: origin,
      RENDER_EXTERNAL_URL: render,
    }).app.origin,
    origin,
  );
});

test("service configuration requires complete trusted endpoints and keeps disabled services absent", () => {
  assert.equal(readConfig({}).app.oidc, undefined);
  assert.equal(readConfig({}).app.mail, undefined);
  assert.throws(
    () =>
      readConfig({
        OIDC_ISSUER: oidc.issuer,
        OIDC_CLIENT_ID: "client",
        OIDC_CLIENT_SECRET: "secret",
      }),
    /APP_ORIGIN/,
  );
  assert.throws(
    () =>
      readConfig({
        APP_ORIGIN: origin,
        OIDC_ISSUER: "http://identity.internal",
        OIDC_CLIENT_ID: "client",
        OIDC_CLIENT_SECRET: "secret",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      readConfig({ APP_ORIGIN: origin, SMTP_HOST: "host", SMTP_FROM: "bad" }),
    /SMTP_FROM/,
  );
  assert.throws(
    () =>
      readConfig({
        APP_ORIGIN: origin,
        SMTP_HOST: "host",
        SMTP_FROM: mail.from,
        SMTP_USER: "missing-password",
      }),
    /together/,
  );
  const configured = readConfig({
    APP_ORIGIN: origin,
    OIDC_ISSUER: oidc.issuer,
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    SMTP_HOST: "smtp.internal",
    SMTP_FROM: mail.from,
  });
  assert.equal(configured.app.oidc?.accountPolicy, "existing");
  assert.equal(configured.app.mail?.secure, false);
  assert.equal(configured.app.mail?.scheduled, true);
});
