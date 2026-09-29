import test from "node:test";
import assert from "node:assert/strict";
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

test("a problem report is emailed to the other administrators who keep that preference on", async (t) => {
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
  const second = await h.account("second-admin@example.test"),
    quiet = await h.account("quiet-admin@example.test"),
    member = await h.account("member@example.test");
  for (const admin of [second, quiet])
    assert.equal(
      (
        await h.owner.request(`/admin/accounts/${admin.user.id}`, "PATCH", {
          isAdmin: true,
        })
      ).status,
      200,
    );
  // Their invitations were emailed too.
  await h.mail.flush();
  messages.length = 0;
  // One administrator turned these emails off.
  await quiet.client.request("/account/email-feedback", "PUT", {
    enabled: false,
  });
  const sent = await member.client.request("/feedback", "POST", {
    kind: "bug",
    message: "Le minuteur se fige quand je change d’onglet.",
    page: "/session/abc",
  });
  assert.equal(sent.status, 201);
  await h.mail.flush();
  assert.deepEqual(messages.map((message) => message.to).sort(), [
    owner.email,
    "second-admin@example.test",
  ]);
  assert.match(messages[0].text, /Le minuteur se fige/);
  assert.match(messages[0].text, /\/account\/feedback-inbox/);
  assert.match(messages[0].text, /member@example\.test/);

  // The author of a report is never emailed about their own report.
  messages.length = 0;
  await h.owner.request("/feedback", "POST", {
    kind: "idea",
    message: "Un mode sombre.",
  });
  await h.mail.flush();
  assert.deepEqual(
    messages.map((message) => message.to),
    ["second-admin@example.test"],
  );
});

test("the author of a report hears when its status changes, in the app and by email", async (t) => {
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
  const member = await h.account("member@example.test");
  const sent = await member.client.request("/feedback", "POST", {
    kind: "bug",
    message: "Le minuteur se fige quand je change d’onglet.",
  });
  await h.mail.flush();
  messages.length = 0;
  const id = sent.body.feedback.id;
  const status = async (value: string) =>
    assert.equal(
      (
        await h.owner.request(`/admin/feedback/${id}`, "PATCH", {
          status: value,
        })
      ).status,
      200,
    );
  await status("in-progress");
  await h.mail.flush();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "member@example.test");
  assert.match(messages[0].text, /Le minuteur se fige/);
  assert.match(messages[0].text, /\/account\/feedback/);
  const bell = (await member.client.request("/notifications?kinds=2")).body;
  assert.equal(bell.unread, 1);
  assert.equal(bell.notifications[0].kind, "feedback-status");
  assert.equal(bell.notifications[0].actor, owner.name);
  // A 0.1.3 page, still open during a rollout, does not get a kind it
  // cannot open.
  assert.equal(
    (await member.client.request("/notifications")).body.notifications.length,
    0,
  );

  // Setting the same status again says nothing new.
  await status("in-progress");
  await h.mail.flush();
  assert.equal(messages.length, 1);

  // Further changes group in the bell while unread; each one is emailed.
  await status("done");
  await h.mail.flush();
  assert.equal(messages.length, 2);
  const grouped = (await member.client.request("/notifications?kinds=2")).body;
  assert.equal(grouped.unread, 1);
  assert.equal(grouped.notifications[0].count, 2);

  // An administrator updating their own report is not notified.
  const own = await h.owner.request("/feedback", "POST", {
    kind: "idea",
    message: "Un mode sombre.",
  });
  messages.length = 0;
  await h.owner.request(`/admin/feedback/${own.body.feedback.id}`, "PATCH", {
    status: "done",
  });
  await h.mail.flush();
  assert.equal(messages.length, 0);
  assert.equal(
    (await h.owner.request("/notifications?kinds=2")).body.notifications.some(
      (item: { kind: string }) => item.kind === "feedback-status",
    ),
    false,
  );
});

test("invitations are emailed with their link when SMTP is configured", async (t) => {
  const messages: MailMessage[] = [],
    h = await harness(t, {
      mail,
      mailTransport: {
        async send(message) {
          messages.push(message);
        },
      },
    });
  await h.setup();
  const session = await h.session();
  const existing = await h.account("existing@example.test");
  await h.mail.flush();
  messages.length = 0;
  const to = (address: string) =>
    messages.find((message) => message.to === address);

  // Someone without an account: the private link to join.
  const newcomer = await h.owner.request(
    `/sessions/${session.id}/invitations`,
    "POST",
    {
      name: "Nouvelle animatrice",
      email: "newcomer@example.test",
      role: "facilitator",
    },
  );
  assert.equal(newcomer.status, 201);
  assert.equal(newcomer.body.emailed, true);
  // An existing account: added at once, and told where to find the session.
  const added = await h.owner.request(
    `/sessions/${session.id}/invitations`,
    "POST",
    { name: "Existing", email: "existing@example.test", role: "editor" },
  );
  assert.equal(added.status, 201);
  // An account invitation from the administration.
  const account = await h.owner.request("/auth/invites", "POST", {
    name: "Colleague",
    email: "colleague@example.test",
  });
  assert.equal(account.status, 201);
  assert.equal(account.body.emailed, true);
  // A workspace invitation.
  const workspace = (
    await h.owner.request("/workspaces", "POST", { name: "Équipe projet" })
  ).body.workspace;
  const joined = await h.owner.request(
    `/workspaces/${workspace.id}/members`,
    "POST",
    { email: "teammate@example.test", role: "editor" },
  );
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  await h.mail.flush();

  assert.match(
    to("newcomer@example.test")!.text,
    new RegExp(`/join/${newcomer.body.token}`),
  );
  assert.match(to("newcomer@example.test")!.text, new RegExp(session.title));
  // Each email names only what the role allows.
  assert.match(
    to("newcomer@example.test")!.text,
    / à animer la séance | to run the session /,
  );
  assert.match(
    to("existing@example.test")!.text,
    /à préparer et animer la séance|to prepare and run the session/,
  );
  assert.match(
    to("existing@example.test")!.text,
    new RegExp(`/session/${session.id}`),
  );
  assert.equal(to("existing@example.test")!.text.includes("/join/"), false);
  assert.match(
    to("colleague@example.test")!.text,
    new RegExp(`/join/${account.body.token}`),
  );
  assert.match(
    to("teammate@example.test")!.text,
    new RegExp(`/join/${joined.body.token}`),
  );
  assert.match(to("teammate@example.test")!.text, /Équipe projet/);
  assert.equal(messages.length, 4);
  void existing;
});

test("report emails survive a failed send and profiles saved before the option existed", async (t) => {
  let failing = true;
  const messages: MailMessage[] = [],
    h = await harness(t, {
      mail,
      mailTransport: {
        async send(message) {
          if (failing) throw new Error("SMTP unavailable");
          messages.push(message);
        },
      },
    });
  await h.setup();
  const second = await h.account("second-admin@example.test");
  assert.equal(
    (
      await h.owner.request(`/admin/accounts/${second.user.id}`, "PATCH", {
        isAdmin: true,
      })
    ).status,
    200,
  );
  // A profile saved by an earlier version, without the report-email option.
  await h.db.run(
    "INSERT INTO account_profiles(user_id,payload) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload",
    [
      second.user.id,
      JSON.stringify({
        preferences: {
          displayTimezone: "",
          hour12: false,
          inAppMentions: true,
          emailDigest: false,
          emailReminder: false,
        },
      }),
    ],
  );
  assert.equal(
    (await second.client.request("/account")).body.emailFeedback,
    true,
  );
  await h.mail.flush();
  // The SMTP server is down when the report arrives: the email waits in the
  // database, not in one pod's memory.
  await h.owner.request("/feedback", "POST", {
    kind: "bug",
    message: "Le minuteur se fige.",
  });
  await h.mail.flush();
  assert.equal(messages.length, 0);
  assert.equal((await h.db.all("SELECT id FROM mail_outbox")).length, 1);
  // Any pod retries it once the server is back.
  failing = false;
  await h.mail.deliverQueued(Date.now() + 6 * 60 * 1000);
  assert.deepEqual(
    messages.map((message) => message.to),
    ["second-admin@example.test"],
  );
  assert.equal((await h.db.all("SELECT id FROM mail_outbox")).length, 0);
});

test("invitation emails are sent before answering, in the recipient's language, and not repeated", async (t) => {
  let failing = true;
  const messages: MailMessage[] = [],
    h = await harness(t, {
      mail,
      mailTransport: {
        async send(message) {
          if (failing) throw new Error("SMTP unavailable");
          messages.push(message);
        },
      },
    });
  await h.setup();
  const session = await h.session();
  const english = await h.account("english@example.test");
  // The SMTP server is down: the inviter is told to pass the link on.
  const unsent = await h.owner.request(
    `/sessions/${session.id}/invitations`,
    "POST",
    { name: "Newcomer", email: "newcomer@example.test", role: "viewer" },
  );
  assert.equal(unsent.status, 201);
  assert.equal(unsent.body.emailed, false);
  assert.ok(unsent.body.token);

  failing = false;
  const invite = () =>
    h.owner.request(`/sessions/${session.id}/invitations`, "POST", {
      name: "English",
      email: "english@example.test",
      role: "editor",
    });
  const first = await invite();
  assert.equal(first.body.emailed, true);
  // Sent before the answer, in the English account's own language.
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "english@example.test");
  assert.match(messages[0].subject, /added you/);
  // Adding the same person again does not email them again.
  const again = await invite();
  assert.equal(again.status, 201);
  assert.equal(again.body.emailed, false);
  assert.equal(messages.length, 1);
  // A new invitation replaces the previous link: the new one is always sent.
  const renew = () =>
    h.owner.request(`/sessions/${session.id}/invitations`, "POST", {
      name: "Newcomer",
      email: "newcomer@example.test",
      role: "viewer",
    });
  assert.equal((await renew()).body.emailed, true);
  const renewed = await renew();
  assert.equal(renewed.body.emailed, true);
  assert.match(
    messages.at(-1)!.text,
    new RegExp(`/join/${renewed.body.token}`),
  );
  // A viewer is not promised to prepare or run the session.
  assert.match(
    messages.at(-1)!.text,
    /à suivre la séance|to follow the session/,
  );
  assert.doesNotMatch(messages.at(-1)!.text, /animer|run the session/);
  void english;
});

test("a join link replaced while its email was sent is not reported as emailed", async (t) => {
  let replace: (() => Promise<void>) | undefined;
  const h = await harness(t, {
    mail,
    mailTransport: {
      async send() {
        // The same invitation sent again from another tab meanwhile.
        await replace?.();
      },
    },
  });
  await h.setup();
  replace = async () => {
    await h.db.run("DELETE FROM invites WHERE email=$1", ["late@example.test"]);
  };
  const invited = await h.owner.request("/auth/invites", "POST", {
    name: "Late",
    email: "late@example.test",
  });
  assert.equal(invited.status, 201);
  assert.equal(invited.body.emailed, false);
});

test("the report-email option is saved on its own, so older servers keep accepting profile saves", async (t) => {
  const h = await harness(t);
  await h.setup();
  const account = (await h.owner.request("/account")).body;
  // The profile keeps the shape older pages send back as is; the option
  // travels beside it.
  const older = account.profile.preferences;
  assert.equal("emailFeedback" in older, false);
  assert.equal(account.emailFeedback, true);
  assert.equal(
    (
      await h.owner.request("/account/email-feedback", "PUT", {
        enabled: false,
      })
    ).status,
    200,
  );
  // A profile save without the option, as older servers expect it, keeps it.
  const saved = await h.owner.request("/account", "PUT", {
    name: account.user.name,
    email: account.user.email,
    locale: account.user.locale,
    preferences: older,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal("emailFeedback" in saved.body.profile.preferences, false);
  assert.equal((await h.owner.request("/account")).body.emailFeedback, false);
  // A 0.1.3 pod rewriting the whole profile cannot turn it back on.
  await h.db.run("UPDATE account_profiles SET payload=$1 WHERE user_id=$2", [
    JSON.stringify({ preferences: older }),
    account.user.id,
  ]);
  assert.equal((await h.owner.request("/account")).body.emailFeedback, false);
});

test("a queued email is dropped when its recipient lost the access it was about", async (t) => {
  let failing = true;
  const messages: MailMessage[] = [],
    h = await harness(t, {
      mail,
      mailTransport: {
        async send(message) {
          if (failing) throw new Error("SMTP unavailable");
          messages.push(message);
        },
      },
    });
  await h.setup();
  const second = await h.account("second-admin@example.test");
  await h.owner.request(`/admin/accounts/${second.user.id}`, "PATCH", {
    isAdmin: true,
  });
  await h.mail.flush();
  await h.owner.request("/feedback", "POST", {
    kind: "bug",
    message: "Détail privé du signalement.",
  });
  await h.mail.flush();
  // No longer an administrator when the SMTP server comes back.
  await h.owner.request(`/admin/accounts/${second.user.id}`, "PATCH", {
    isAdmin: false,
  });
  failing = false;
  await h.mail.deliverQueued(Date.now() + 6 * 60 * 1000);
  assert.equal(messages.length, 0);
  assert.equal((await h.db.all("SELECT id FROM mail_outbox")).length, 0);

  // Turned off while it waited: not sent either.
  failing = true;
  await h.owner.request(`/admin/accounts/${second.user.id}`, "PATCH", {
    isAdmin: true,
  });
  await h.owner.request("/feedback", "POST", {
    kind: "idea",
    message: "Une autre idée.",
  });
  await h.mail.flush();
  await second.client.request("/account/email-feedback", "PUT", {
    enabled: false,
  });
  failing = false;
  await h.mail.deliverQueued(Date.now() + 12 * 60 * 1000);
  assert.equal(messages.length, 0);
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
