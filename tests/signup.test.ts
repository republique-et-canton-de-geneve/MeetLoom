import test from "node:test";
import assert from "node:assert/strict";
import { harness, password } from "./support.js";

test("anyone can create their own account once the installation is set up", async (t) => {
  const h = await harness(t);
  const visitor = h.client();
  const early = await visitor.request("/auth/signup", "POST", {
    name: "Early",
    email: "early@example.test",
    password,
  });
  assert.equal(early.status, 409, "the first account is the setup account");
  assert.equal(early.body.code, "SETUP_REQUIRED");
  await h.setup();
  const status = await visitor.request("/auth/status");
  assert.equal(status.body.signupEnabled, true);
  const created = await visitor.request("/auth/signup", "POST", {
    name: "Camille",
    email: "camille@example.test",
    password,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.isAdmin, false);
  const other = h.client();
  await other.request("/auth/signup", "POST", {
    name: "Dominique",
    email: "dominique@example.test",
    password,
  });
  const mine = await visitor.request("/sessions", "POST", {
    title: "Camille's workshop",
    locale: "en",
  });
  assert.equal(mine.status, 201);
  const listed = await other.request("/sessions");
  assert.equal(
    JSON.stringify(listed.body).includes("Camille's workshop"),
    false,
    "each account only sees its own sessions",
  );
  assert.equal(
    (await other.request(`/sessions/${mine.body.session.id}`)).status,
    404,
  );
});

test("an administrator can close sign-up again (invitations only)", async (t) => {
  const h = await harness(t);
  await h.setup();
  await h.owner.request("/admin/settings/signup", "PUT", {
    enabled: false,
    domains: [],
  });
  const visitor = h.client();
  assert.equal(
    (await visitor.request("/auth/status")).body.signupEnabled,
    false,
  );
  const refused = await visitor.request("/auth/signup", "POST", {
    name: "Camille",
    email: "camille@example.test",
    password,
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "SIGNUP_DISABLED");
});

test("an enabled policy creates ordinary accounts, restricted to allowed domains", async (t) => {
  const h = await harness(t);
  await h.setup();
  const settings = await h.owner.request("/admin/settings");
  assert.equal(settings.status, 200);
  assert.deepEqual(settings.body.signup, { enabled: true, domains: [] });
  assert.deepEqual(settings.body.services, {
    smtp: false,
    oidc: false,
    ai: null,
  });
  assert.equal(
    (
      await h.owner.request("/admin/settings/signup", "PUT", {
        enabled: true,
        domains: ["Example.Test", "example.test"],
      })
    ).body.signup.domains.length,
    1,
  );
  const visitor = h.client();
  const status = await visitor.request("/auth/status");
  assert.equal(status.body.signupEnabled, true);
  assert.deepEqual(status.body.signupDomains, ["example.test"]);
  const outsider = await visitor.request("/auth/signup", "POST", {
    name: "Outsider",
    email: "someone@elsewhere.test",
    password,
  });
  assert.equal(outsider.status, 403);
  assert.equal(outsider.body.code, "SIGNUP_DOMAIN");
  const weak = await visitor.request("/auth/signup", "POST", {
    name: "Short",
    email: "short@example.test",
    password: "short",
  });
  assert.equal(weak.status, 400);
  const created = await visitor.request("/auth/signup", "POST", {
    name: "Camille",
    email: "camille@example.test",
    password,
    locale: "en",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.user.isAdmin, false);
  const me = await visitor.request("/auth/status");
  assert.equal(me.body.user.email, "camille@example.test");
  const session = await visitor.request("/sessions", "POST", {
    title: "Mine",
    locale: "en",
  });
  assert.equal(session.status, 201, "the new account can work right away");
  assert.equal(
    (await visitor.request("/admin/settings")).status,
    403,
    "a self-registered account is not an administrator",
  );
  const duplicate = await h.client().request("/auth/signup", "POST", {
    name: "Again",
    email: "camille@example.test",
    password,
  });
  assert.equal(duplicate.status, 409);
});

test("only administrators change the sign-up policy, with validated domains", async (t) => {
  const h = await harness(t);
  await h.setup();
  const member = await h.account("member@example.test");
  assert.equal(
    (
      await member.client.request("/admin/settings/signup", "PUT", {
        enabled: true,
        domains: [],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.owner.request("/admin/settings/signup", "PUT", {
        enabled: true,
        domains: ["not a domain"],
      })
    ).status,
    400,
  );
  const open = await h.owner.request("/admin/settings/signup", "PUT", {
    enabled: true,
    domains: [],
  });
  assert.equal(open.status, 200);
  assert.equal(
    (
      await h.client().request("/auth/signup", "POST", {
        name: "Anyone",
        email: "anyone@anywhere.test",
        password,
      })
    ).status,
    201,
    "no domain list means any email address",
  );
});
