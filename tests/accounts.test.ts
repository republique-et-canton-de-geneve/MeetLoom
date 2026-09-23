import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, password } from "./support.js";
import { DEFAULT_ACCOUNT_PREFERENCES } from "../shared/accounts.js";

test("email changes and account deletion share a credential budget per authenticated account", async (t) => {
  const h = await harness(t, { rateLimits: true, trustProxy: 1 });
  const owner = await h.setup();
  const colleague = await h.account("colleague@example.test");
  const input = {
    name: owner.name,
    email: "changed@example.test",
    locale: "en",
    currentPassword: "incorrect-current-password",
    preferences: DEFAULT_ACCOUNT_PREFERENCES,
  };
  assert.equal(
    (await h.client().request("/account", "PUT", input)).status,
    401,
  );
  for (let attempt = 0; attempt < 10; attempt++) {
    // Switching trusted client addresses cannot reset an account's budget.
    const address = { "X-Forwarded-For": `192.0.2.${attempt + 1}` };
    assert.equal(
      (await h.owner.request("/account", "PUT", input, address)).status,
      401,
    );
    assert.equal(
      (
        await h.owner.request(
          "/account/delete",
          "POST",
          {
            currentPassword: input.currentPassword,
          },
          address,
        )
      ).status,
      401,
    );
  }
  for (const [path, method, body] of [
    ["/account", "PUT", { ...input, currentPassword: password }],
    ["/account/delete", "POST", { currentPassword: password }],
  ] as const) {
    const limited = await h.owner.request(path, method, body);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, "RATE_LIMITED");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  }
  const unchanged = await h.owner.request("/account");
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.user.email, owner.email);
  assert.equal((await h.owner.request("/sessions")).status, 200);
  // Both clients use the same loopback address. The other account keeps its budget.
  const independent = await colleague.client.request("/account", "PUT", {
    ...input,
    email: colleague.user.email,
    name: "Colleague updated",
  });
  assert.equal(independent.status, 200, JSON.stringify(independent.body));
  assert.equal(
    (
      await colleague.client.request("/account/delete", "POST", {
        currentPassword: input.currentPassword,
      })
    ).status,
    401,
  );
});

test("account credential limiting remains disabled when rateLimits is false", async (t) => {
  const h = await harness(t, { rateLimits: false });
  const owner = await h.setup();
  for (let attempt = 0; attempt < 21; attempt++) {
    // Invalid bodies are counted before validation when the limiter is enabled.
    assert.equal((await h.owner.request("/account", "PUT", {})).status, 400);
    assert.equal(
      (await h.owner.request("/account/delete", "POST", {})).status,
      400,
    );
  }
  const saved = await h.owner.request("/account", "PUT", {
    name: "Still editable",
    email: owner.email,
    locale: "en",
    preferences: DEFAULT_ACCOUNT_PREFERENCES,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
});

test("profile changes require password for email, reject unsafe avatar and keep preferences private", async (t) => {
  const h = await harness(t),
    owner = await h.setup();
  const session = await h.session();
  const profile = {
    name: "Updated owner",
    email: owner.email,
    locale: "en",
    preferences: {
      ...DEFAULT_ACCOUNT_PREFERENCES,
      displayTimezone: "America/New_York",
      hour12: true,
    },
  };
  assert.equal((await h.client().request("/account")).status, 401);
  assert.equal(
    (
      await h.owner.request("/account", "PUT", {
        ...profile,
        email: "new@example.test",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await h.owner.request("/account", "PUT", {
        ...profile,
        avatar: "data:image/svg+xml;base64,PHNjcmlwdD4=",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.owner.request("/account", "PUT", {
        ...profile,
        preferences: {
          ...profile.preferences,
          displayTimezone: "invalid-zone",
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.owner.request("/account", "PUT", {
        ...profile,
        email: "new@example.test",
        currentPassword: password,
      })
    ).status,
    200,
  );
  assert.equal(
    (await h.owner.request("/auth/status")).body.user.name,
    "Updated owner",
  );
  assert.equal(
    (await h.owner.request("/account")).body.profile.preferences.hour12,
    true,
  );
  const share = (
    await h.owner.request(`/sessions/${session.id}/shares`, "POST", {
      label: "Public",
    })
  ).body.share;
  assert.equal(
    JSON.stringify(
      (await h.client().request(`/public/${share.token}`)).body,
    ).includes("new@example.test"),
    false,
  );
  assert.equal(
    (
      await h
        .client()
        .request("/auth/login", "POST", { email: "new@example.test", password })
    ).status,
    200,
  );
});

test("administration revokes sessions and one-use recovery rotates credentials without leaking tokens", async (t) => {
  const h = await harness(t);
  await h.setup();
  const member = await h.account("member@example.test");
  assert.equal((await member.client.request("/admin/accounts")).status, 403);
  const recovery = await h.owner.request(
    `/admin/accounts/${member.user.id}/reset`,
    "POST",
    {},
  );
  assert.equal(recovery.status, 201);
  const client = h.client(),
    newPassword = "different-long-password-2026";
  assert.equal(
    (
      await client.request("/auth/reset-password", "POST", {
        token: recovery.body.token,
        password: newPassword,
      })
    ).status,
    200,
  );
  assert.equal((await member.client.request("/account")).status, 401);
  assert.equal(
    (
      await h.client().request("/auth/reset-password", "POST", {
        token: recovery.body.token,
        password: newPassword,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h
        .client()
        .request("/auth/login", "POST", { email: member.user.email, password })
    ).status,
    401,
  );
  assert.equal(
    (
      await h.owner.request(`/admin/accounts/${member.user.id}`, "PATCH", {
        disabled: true,
      })
    ).status,
    200,
  );
  assert.equal((await client.request("/account")).status, 401);
  assert.equal(
    (
      await h.client().request("/auth/login", "POST", {
        email: member.user.email,
        password: newPassword,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await h.owner.request(
        `/admin/accounts/${member.user.id}/reset`,
        "POST",
        {},
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await h.owner.request(`/admin/accounts/${member.user.id}`, "PATCH", {
        disabled: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await h.client().request("/auth/login", "POST", {
        email: member.user.email,
        password: newPassword,
      })
    ).status,
    200,
  );
});

test("account deletion protects last admin, transfers ownership and anonymizes historical author", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    session = await h.session(),
    member = await h.account("successor@example.test");
  const path = `/sessions/${session.id}`;
  assert.equal(
    (
      await h.owner.request("/folders", "POST", {
        path: "Private/Empty",
        version: 0,
      })
    ).status,
    201,
  );
  await h.owner.request(path + "/comments", "POST", {
    text: "Keep this project decision",
  });
  assert.equal(
    (
      await h.owner.request("/account/delete", "POST", {
        currentPassword: password,
        transferEmail: member.user.email,
      })
    ).body.code,
    "LAST_ADMIN",
  );
  assert.equal(
    (
      await h.owner.request(`/admin/accounts/${member.user.id}`, "PATCH", {
        isAdmin: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await h.owner.request("/account/delete", "POST", {
        currentPassword: password,
      })
    ).body.code,
    "TRANSFER_REQUIRED",
  );
  const deleted = await h.owner.request("/account/delete", "POST", {
    currentPassword: password,
    transferEmail: member.user.email,
  });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(
    (
      await h.db.all("SELECT id FROM folder_scopes WHERE id=$1", [
        `user:${owner.id}`,
      ])
    ).length,
    0,
  );
  assert.equal((await h.owner.request("/account")).status, 401);
  const transferred = await member.client.request(path);
  assert.equal(transferred.status, 200);
  assert.equal(transferred.body.role, "owner");
  assert.equal(transferred.body.session.ownerId, member.user.id);
  const comments = (await member.client.request(path + "/comments")).body
    .comments;
  assert.equal(comments[0].author, "Deleted user");
  const [row] = await h.db.all<{ email: string }>(
    "SELECT email FROM users WHERE id=$1",
    [owner.id],
  );
  assert.notEqual(row.email, owner.email);
});

test("changing email revokes old recovery links and rejects an in-flight profile with the old address", async (t) => {
  const h = await harness(t);
  await h.setup();
  const member = await h.account("old-address@example.test");
  const recovery = (
    await h.owner.request(`/admin/accounts/${member.user.id}/reset`, "POST", {})
  ).body;
  const profile = {
    name: "Member",
    email: member.user.email,
    locale: "en",
    preferences: DEFAULT_ACCOUNT_PREFERENCES,
  };
  const originalAll = h.db.all.bind(h.db);
  const read = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let held = false;
  h.db.all = async <T>(query: string, values?: unknown[]) => {
    const rows = await originalAll<T>(query, values);
    if (!held && query === "SELECT password,email FROM users WHERE id=$1") {
      held = true;
      read.resolve();
      await release.promise;
    }
    return rows;
  };
  const stale = member.client.request("/account", "PUT", profile);
  try {
    await Promise.race([
      read.promise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Profile read hook timed out")),
          5000,
        );
        timer.unref();
      }),
    ]);
    assert.equal(
      (
        await member.client.request("/account", "PUT", {
          ...profile,
          email: "new-address@example.test",
          currentPassword: password,
        })
      ).status,
      200,
    );
  } finally {
    release.resolve();
    h.db.all = originalAll;
  }
  assert.equal((await stale).body.code, "ACCOUNT_CHANGED");
  assert.equal(
    (await member.client.request("/account")).body.user.email,
    "new-address@example.test",
  );
  assert.equal(
    (
      await h.client().request("/auth/reset-password", "POST", {
        token: recovery.token,
        password: "replacement-password-123",
      })
    ).body.code,
    "RESET_INVALID",
  );
});

test("changing the password invalidates recovery links issued before that change", async (t) => {
  const h = await harness(t);
  await h.setup();
  const member = await h.account("password-change@example.test"),
    recovery = (
      await h.owner.request(
        `/admin/accounts/${member.user.id}/reset`,
        "POST",
        {},
      )
    ).body;
  assert.equal(
    (
      await member.client.request("/auth/password", "POST", {
        currentPassword: password,
        newPassword: "replacement-password-123",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await h.client().request("/auth/reset-password", "POST", {
        token: recovery.token,
        password: "obsolete-link-password-123",
      })
    ).body.code,
    "RESET_INVALID",
  );
  assert.equal(
    (
      await h.client().request("/auth/login", "POST", {
        email: member.user.email,
        password: "replacement-password-123",
      })
    ).status,
    200,
  );
});

test("an account-deletion request authorized before password recovery cannot delete the recovered account", async (t) => {
  const h = await harness(t);
  await h.setup();
  const member = await h.account("recovered@example.test"),
    recovery = (
      await h.owner.request(
        `/admin/accounts/${member.user.id}/reset`,
        "POST",
        {},
      )
    ).body;
  const originalAll = h.db.all.bind(h.db);
  const read = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  h.db.all = async <T>(query: string, values?: unknown[]) => {
    const rows = await originalAll<T>(query, values);
    if (query === "SELECT password FROM users WHERE id=$1") {
      read.resolve();
      await release.promise;
    }
    return rows;
  };
  const deletion = member.client.request("/account/delete", "POST", {
    currentPassword: password,
  });
  const recovered = h.client();
  try {
    await Promise.race([
      read.promise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Deletion read hook timed out")),
          5000,
        );
        timer.unref();
      }),
    ]);
    assert.equal(
      (
        await recovered.request("/auth/reset-password", "POST", {
          token: recovery.token,
          password: "replacement-password-123",
        })
      ).status,
      200,
    );
  } finally {
    release.resolve();
    h.db.all = originalAll;
  }
  assert.equal((await deletion).body.code, "ACCOUNT_CHANGED");
  assert.equal(
    (await recovered.request("/account")).body.user.email,
    member.user.email,
  );
});
