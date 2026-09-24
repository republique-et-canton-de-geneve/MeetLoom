import test from "node:test";
import assert from "node:assert/strict";
import {
  AsyncNavigation,
  registerNavigationGuard,
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
