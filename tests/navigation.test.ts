import test from "node:test";
import assert from "node:assert/strict";
import {
  AsyncNavigation,
  dashboardUrl,
  dashboardWorkspace,
  registerNavigationGuard,
  rememberWorkspace,
  type NavigationHost,
} from "../src/navigation.js";
function memory(initial = "/session/one") {
  const entries = [
    { url: `https://meetloom.test${initial}`, state: null as unknown },
  ];
  let index = 0,
    listener: (() => void) | undefined;
  const commits: string[] = [];
  const host: NavigationHost = {
    read: () => entries[index],
    replace: (state, url) => {
      entries[index] = { state, url };
    },
    push: (state, url) => {
      entries.splice(index + 1);
      entries.push({ state, url });
      index++;
    },
    go: (delta) => {
      index += delta;
      if (index < 0 || index >= entries.length)
        throw new Error("Invalid history traversal");
      listener?.();
    },
    listen: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    commit: (url) => commits.push(url),
  };
  return {
    host,
    entries,
    commits,
    get index() {
      return index;
    },
  };
}
test("programmatic navigation waits for agenda and secondary drafts, preserving the route on failure", async () => {
  const history = memory(),
    gate = Promise.withResolvers<boolean>();
  let calls = 0;
  const navigation = new AsyncNavigation(history.host, () => {
    calls++;
    return gate.promise;
  });
  const stop = navigation.start();
  const pending = navigation.navigate("/session/two?block=abc");
  await Promise.resolve();
  assert.equal(history.index, 0);
  assert.equal(history.commits.length, 0);
  assert.equal(
    await navigation.navigate("/session/three"),
    false,
    "second request cannot overtake saving",
  );
  gate.resolve(false);
  assert.equal(await pending, false);
  assert.equal(history.host.read().url, "https://meetloom.test/session/one");
  assert.equal(calls, 1);
  stop();
});
test("Back and Forward await guards, restore the original entry on failure and keep forward history", async () => {
  const history = memory("/");
  let allowed = true;
  const navigation = new AsyncNavigation(history.host, async () => allowed);
  navigation.start();
  await navigation.navigate("/session/one");
  await navigation.navigate("/session/two");
  const count = history.entries.length;
  allowed = false;
  history.host.go(-1);
  await navigation.settled();
  assert.equal(history.index, 2);
  assert.equal(history.host.read().url, "https://meetloom.test/session/two");
  assert.equal(history.entries.length, count, "no duplicate route is pushed");
  allowed = true;
  history.host.go(-1);
  await navigation.settled();
  assert.equal(history.index, 1);
  assert.equal(history.commits.at(-1), "https://meetloom.test/session/one");
  allowed = false;
  history.host.go(1);
  await navigation.settled();
  assert.equal(history.index, 1);
  allowed = true;
  history.host.go(1);
  await navigation.settled();
  assert.equal(history.index, 2);
});
test("rapid history traversal saves once and commits only the latest target", async () => {
  const history = memory("/");
  let gate: Promise<boolean> | undefined,
    calls = 0;
  const navigation = new AsyncNavigation(history.host, () => {
    calls++;
    return gate ?? Promise.resolve(true);
  });
  navigation.start();
  await navigation.navigate("/session/one");
  await navigation.navigate("/session/two");
  const deferred = Promise.withResolvers<boolean>();
  gate = deferred.promise;
  calls = 0;
  history.host.go(-1);
  history.host.go(-1);
  await Promise.resolve();
  assert.equal(calls, 1);
  deferred.resolve(true);
  await navigation.settled();
  assert.equal(history.index, 0);
  assert.equal(history.commits.at(-1), "https://meetloom.test/");
});
test("browser Back takes precedence over a pending notification navigation after the same save", async () => {
  const history = memory("/");
  let gate: Promise<boolean> | undefined;
  const navigation = new AsyncNavigation(
    history.host,
    () => gate ?? Promise.resolve(true),
  );
  navigation.start();
  await navigation.navigate("/session/one");
  const deferred = Promise.withResolvers<boolean>();
  gate = deferred.promise;
  const pending = navigation.navigate("/session/notification?comment=123");
  history.host.go(-1);
  deferred.resolve(true);
  await pending;
  assert.equal(history.commits.at(-1), "https://meetloom.test/");
  assert.equal(history.entries.length, 2);
});
test("registered guards run in order, report refusal without dropping the component, and unregister cleanly", async () => {
  const history = memory(),
    events: string[] = [];
  let valid = false;
  const removeFirst = registerNavigationGuard(async () => {
    events.push("secondary");
    return valid;
  });
  const removeSecond = registerNavigationGuard(async () => {
    events.push("agenda");
    return true;
  });
  try {
    const navigation = new AsyncNavigation(history.host);
    navigation.start();
    assert.equal(await navigation.navigate("/"), false);
    assert.deepEqual(events, ["secondary"]);
    valid = true;
    assert.equal(await navigation.navigate("/"), true);
    assert.deepEqual(events, ["secondary", "secondary", "agenda"]);
    assert.equal(await navigation.navigate("https://outside.example/"), false);
  } finally {
    removeFirst();
    removeSecond();
  }
});
test("a failed guard on an unmarked history entry restores the route without losing local component state", async () => {
  const history = memory("/");
  let allowed = true;
  const navigation = new AsyncNavigation(history.host, async () => allowed);
  navigation.start();
  await navigation.navigate("/session/one");
  history.entries[0].state = null;
  allowed = false;
  history.host.go(-1);
  await navigation.settled();
  assert.equal(history.host.read().url, "https://meetloom.test/session/one");
  assert.equal(history.commits.at(-1), "https://meetloom.test/session/one");
});
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
const blocked = {
  getItem: (): string | null => {
    throw new Error("Storage blocked");
  },
  setItem: () => {
    throw new Error("Storage blocked");
  },
};
test("the dashboard address names every workspace scope, all of them included", () => {
  const uuid = "6f1c2a52-7d3e-4b8a-9c1f-2e5d8a7b6c40";
  assert.equal(dashboardUrl("all"), "/?workspace=all");
  assert.equal(dashboardUrl("personal"), "/?workspace=personal");
  assert.equal(dashboardUrl(uuid), `/?workspace=${uuid}`);
  for (const scope of ["all", "personal", uuid])
    assert.equal(
      dashboardWorkspace(
        `https://meetloom.test${dashboardUrl(scope)}`,
        "u1",
        storage(),
      ),
      scope,
    );
  const remembered = storage();
  rememberWorkspace("u1", "w-1", remembered);
  assert.equal(
    dashboardWorkspace(
      "https://meetloom.test/?workspace=all",
      "u1",
      remembered,
    ),
    "all",
    "an explicit address beats the remembered choice",
  );
  assert.equal(
    dashboardWorkspace("https://meetloom.test/?workspace=", "u1", remembered),
    "w-1",
  );
  assert.equal(
    dashboardWorkspace(
      "https://meetloom.test/?workspace=%20",
      "u1",
      remembered,
    ),
    "w-1",
  );
});
test("a bare dashboard address resumes the account's last workspace, and another account starts from all of them", () => {
  const remembered = storage();
  rememberWorkspace("u1", "w-1", remembered);
  assert.equal(
    dashboardWorkspace("https://meetloom.test/", "u1", remembered),
    "w-1",
  );
  assert.equal(
    dashboardWorkspace(
      "https://meetloom.test/?workspace=personal",
      "u1",
      remembered,
    ),
    "personal",
  );
  assert.equal(
    dashboardWorkspace("https://meetloom.test/", "u2", remembered),
    "all",
  );
  assert.ok([...remembered.values.keys()].some((key) => key.includes("u1")));
});
test("blocked browser storage (private browsing) falls back to all workspaces without failing", () => {
  assert.equal(
    dashboardWorkspace("https://meetloom.test/", "u1", blocked),
    "all",
  );
  assert.doesNotThrow(() => rememberWorkspace("u1", "w-1", blocked));
  assert.equal(
    dashboardWorkspace("https://meetloom.test/?workspace=w-2", "u1", blocked),
    "w-2",
  );
});
test("replace rewrites the dashboard address without a guard, a new entry or a route change, and Back returns to it", async () => {
  const history = memory("/");
  let calls = 0;
  const navigation = new AsyncNavigation(history.host, async () => {
    calls++;
    return true;
  });
  navigation.start();
  const stamp = history.host.read().state;
  assert.equal(await navigation.replace("/?workspace=w-1"), true);
  assert.equal(history.entries.length, 1);
  assert.equal(history.host.read().url, "https://meetloom.test/?workspace=w-1");
  assert.deepEqual(history.host.read().state, stamp, "it keeps its position");
  assert.equal(history.commits.length, 0);
  assert.equal(calls, 0);
  assert.equal(await navigation.navigate("/?workspace=w-1"), true);
  assert.equal(history.entries.length, 1, "the same address adds no entry");
  await navigation.navigate("/session/one");
  history.host.go(-1);
  await navigation.settled();
  assert.equal(history.commits.at(-1), "https://meetloom.test/?workspace=w-1");
  const entry = { ...history.host.read() };
  assert.equal(await navigation.replace("https://outside.example/"), false);
  assert.equal(await navigation.replace("/session/two"), false);
  assert.deepEqual(history.host.read(), entry);
});
test("a page reached by a click rewrites its address once the navigation settles", async () => {
  // React renders a page reached by a click, and runs its effects, in a
  // microtask queued by the commit, before the navigation has settled.
  const history = memory();
  let requested: Promise<boolean> | undefined;
  const navigation: AsyncNavigation = new AsyncNavigation(
    {
      ...history.host,
      commit: (url) => {
        history.host.commit(url);
        queueMicrotask(() => {
          requested = navigation.replace("/?workspace=personal");
        });
      },
    },
    async () => true,
  );
  navigation.start();
  assert.equal(await navigation.navigate("/"), true);
  assert.equal(await requested, true);
  assert.equal(history.entries.length, 2);
  assert.equal(
    history.host.read().url,
    "https://meetloom.test/?workspace=personal",
  );
  assert.equal(history.commits.at(-1), "https://meetloom.test/");
});
test("replace waits for Back/Forward or a navigation to settle, so it never rewrites the entry being reached", async () => {
  const history = memory("/");
  let gate: Promise<boolean> | undefined;
  const navigation = new AsyncNavigation(
    history.host,
    () => gate ?? Promise.resolve(true),
  );
  navigation.start();
  await navigation.navigate("/session/one");
  history.host.go(-1);
  await navigation.settled();
  assert.equal(history.commits.at(-1), "https://meetloom.test/");
  const forward = Promise.withResolvers<boolean>();
  gate = forward.promise;
  history.host.go(1);
  assert.equal(history.index, 1);
  const during = navigation.replace("/?workspace=w-1");
  forward.resolve(true);
  assert.equal(await during, false, "the session reached is another page");
  assert.match(history.entries[1].url, /\/session\/one$/);
  assert.match(history.commits.at(-1)!, /\/session\/one$/);

  const other = memory("/");
  const leaving = Promise.withResolvers<boolean>();
  const pending = new AsyncNavigation(other.host, () => leaving.promise);
  pending.start();
  const opened = pending.navigate("/session/one");
  const rewrite = pending.replace("/?workspace=w-1");
  leaving.resolve(true);
  assert.equal(await opened, true);
  assert.equal(await rewrite, false);
  assert.equal(other.entries[0].url, "https://meetloom.test/");
  const racing = pending.replace("/session/one?tab=notes");
  other.host.go(-1);
  assert.equal(
    await racing,
    false,
    "a Back started meanwhile is not overtaken",
  );
  await pending.settled();
  assert.equal(other.entries[0].url, "https://meetloom.test/");
});
test("a refused Back keeps the rewritten entry, and replace is refused while it returns or once navigation stops", async () => {
  const history = memory("/");
  let allowed = true,
    returning: (() => void) | undefined;
  // Browsers fire popstate for history.go later, not during the call.
  const navigation = new AsyncNavigation(
    {
      ...history.host,
      go: (delta) => {
        returning = () => history.host.go(delta);
      },
    },
    async () => allowed,
  );
  const stop = navigation.start();
  assert.equal(await navigation.replace("/?workspace=w-1"), true);
  await navigation.navigate("/session/one");
  allowed = false;
  history.host.go(-1);
  await navigation.settled();
  assert.equal(history.entries[0].url, "https://meetloom.test/?workspace=w-1");
  assert.equal(await navigation.replace("/session/one?tab=notes"), false);
  assert.equal(history.entries[0].url, "https://meetloom.test/?workspace=w-1");
  returning?.();
  assert.equal(history.index, 1);
  assert.equal(history.host.read().url, "https://meetloom.test/session/one");
  stop();
  assert.equal(await navigation.replace("/session/one?tab=notes"), false);
  assert.equal(history.host.read().url, "https://meetloom.test/session/one");
});
