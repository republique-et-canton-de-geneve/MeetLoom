import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, transitionRun } from "../shared/domain.ts";
import type { Session, SessionResponse } from "../shared/model.ts";
import { apiMessage, ApiError, type api } from "../src/api.ts";
import { api as requestApi } from "../src/api.ts";
import { SessionController } from "../src/useSession.ts";
import { timerAudioStep } from "../src/Timer.tsx";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const response = (session: Session): SessionResponse => ({
  session,
  role: "owner",
});
function fakeApi(
  handler: (path: string, init?: RequestInit) => Promise<SessionResponse>,
): typeof api {
  return <T>(path: string, init?: RequestInit) =>
    handler(path, init) as Promise<T>;
}
const fixture = () => createSession("owner", "Workshop", "en", true);

test("an incomplete draft stays local, then saves normally when valid", async (t) => {
  const session = fixture();
  let writes = 0;
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) => {
      if (init?.method === "PUT") {
        writes++;
        return response({
          ...session,
          ...JSON.parse(init.body as string).session,
          version: 2,
        });
      }
      return response(session);
    }),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "" }));
  assert.equal(await controller.save(), false);
  assert.equal(writes, 0);
  assert.equal(controller.getSnapshot().status, "unsaved");
  assert.equal(controller.getSnapshot().session?.title, "");
  controller.update((value) => ({ ...value, title: "Ready" }));
  assert.equal(await controller.save(), true);
  assert.equal(writes, 1);
  assert.equal(controller.getSnapshot().status, "saved");
});

test("network and validation failures remain retryable without automatic retry loops", async (t) => {
  const session = fixture();
  let writes = 0;
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) => {
      if (init?.method === "PUT") {
        writes++;
        if (writes === 1) throw new ApiError(0, "", "NETWORK_ERROR");
        if (writes === 2) throw new ApiError(400, "", "VALIDATION_ERROR");
        return response({
          ...session,
          ...JSON.parse(init.body as string).session,
          version: 2,
        });
      }
      return response(session);
    }),
    5,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "Changed" }));
  assert.equal(await controller.save(), false);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(writes, 1);
  assert.equal(controller.getSnapshot().status, "unsaved");
  assert.equal(await controller.save(), false);
  controller.update((value) => ({ ...value, title: "Corrected" }));
  assert.equal(controller.getSnapshot().status, "unsaved");
  assert.equal(await controller.save(), true);
  assert.equal(controller.getSnapshot().session?.title, "Corrected");
});

test("edits made during a save are preserved and saved against the new server version", async (t) => {
  const session = fixture(),
    first = deferred<SessionResponse>();
  const sent: { session: Session; version: number }[] = [];
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) => {
      if (init?.method !== "PUT") return response(session);
      const body = JSON.parse(init.body as string);
      sent.push(body);
      if (sent.length === 1) return first.promise;
      return response({ ...session, ...body.session, version: 3 });
    }),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "First edit" }));
  const saving = controller.save();
  await tick();
  controller.update((value) => ({
    ...value,
    description: "Typed during request",
  }));
  first.resolve(response({ ...session, title: "First edit", version: 2 }));
  assert.equal(await saving, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].version, 2);
  assert.equal(sent[1].session.description, "Typed during request");
  assert.equal(
    controller.getSnapshot().session?.description,
    "Typed during request",
  );
});

test("timer commands serialize behind writes and identical double-clicks issue one request", async (t) => {
  const session = fixture(),
    saving = deferred<SessionResponse>(),
    firstAction = deferred<SessionResponse>();
  const calls: string[] = [];
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) => {
      if (init?.method === "PUT") {
        calls.push("save");
        return saving.promise;
      }
      if (init?.method === "POST") {
        const input = JSON.parse(init.body as string);
        calls.push(input.action);
        if (input.action === "start") return firstAction.promise;
        assert.equal(input.revision, 1);
        return response({
          ...session,
          version: 4,
          run: { ...session.run, revision: 2 },
        });
      }
      return response(session);
    }),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "Changed" }));
  const save = controller.save();
  const start = controller.action("start");
  assert.equal(controller.action("start"), start);
  const pause = controller.action("pause");
  await tick();
  assert.deepEqual(calls, ["save"]);
  saving.resolve(response({ ...session, title: "Changed", version: 2 }));
  await save;
  await tick();
  assert.deepEqual(calls, ["save", "start"]);
  firstAction.resolve(
    response({
      ...session,
      title: "Changed",
      version: 3,
      run: { ...session.run, revision: 1 },
    }),
  );
  await Promise.all([start, pause]);
  assert.deepEqual(calls, ["save", "start", "pause"]);
});

test("timer extension merges server duration without losing a concurrently edited draft", async (t) => {
  const session = fixture(),
    extension = deferred<SessionResponse>();
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) =>
      init?.method === "POST" ? extension.promise : response(session),
    ),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  const pending = controller.action("extend", { seconds: 60 });
  await tick();
  controller.update((value) => ({ ...value, title: "Local title" }));
  const extended = structuredClone(session);
  extended.days[0].blocks[0].duration++;
  extended.version++;
  extended.run.revision++;
  extension.resolve(response(extended));
  await pending;
  assert.equal(controller.getSnapshot().session?.title, "Local title");
  assert.equal(
    controller.getSnapshot().session?.days[0].blocks[0].duration,
    extended.days[0].blocks[0].duration,
  );
  assert.equal(controller.getSnapshot().status, "unsaved");
});

test("stopping a timer remains available with an invalid unsaved draft", async (t) => {
  const session = transitionRun(fixture(), "start", {}, 1000);
  let writes = 0;
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) => {
      if (init?.method === "PUT") {
        writes++;
        throw new Error("Must not save invalid draft");
      }
      if (init?.method === "POST")
        return response({
          ...transitionRun(session, "stop", {}, 2000),
          version: 2,
        });
      return response(session);
    }),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "" }));
  await controller.action("stop");
  assert.equal(writes, 0);
  assert.equal(controller.getSnapshot().session?.title, "");
  assert.equal(controller.getSnapshot().session?.run.status, "finished");
  assert.equal(controller.getSnapshot().status, "unsaved");
});

test("a stale polling response cannot overwrite drafts or a new lifecycle", async (t) => {
  const session = fixture(),
    stale = deferred<SessionResponse>();
  let reads = 0;
  const controller = new SessionController(
    session.id,
    fakeApi(async () =>
      ++reads === 2 ? stale.promise : response({ ...session, version: reads }),
    ),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  const pending = controller.poll();
  controller.dispose();
  controller.activate();
  await controller.load();
  controller.update((value) => ({ ...value, title: "New lifecycle draft" }));
  stale.resolve(response({ ...session, title: "Stale", version: 100 }));
  await pending;
  assert.equal(controller.getSnapshot().session?.title, "New lifecycle draft");
  assert.equal(controller.getSnapshot().session?.version, 3);
});

test("pausing with a draft cannot silently overwrite another editor’s unseen changes", async (t) => {
  const session = transitionRun(fixture(), "start", {}, 1000);
  const remote = {
    ...transitionRun(session, "pause", {}, 2000),
    description: "Another editor",
    version: session.version + 2,
  };
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) =>
      response(init?.method === "POST" ? remote : session),
    ),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "Local draft" }));
  await controller.action("pause");
  assert.equal(controller.getSnapshot().session?.title, "Local draft");
  assert.equal(controller.getSnapshot().session?.version, remote.version);
  assert.equal(controller.getSnapshot().session?.description, "Another editor");
  assert.equal(controller.getSnapshot().session?.run.status, "paused");
  assert.equal(controller.getSnapshot().status, "unsaved");
});

test("only a version conflict blocks saving and explicit reload resolves it", async (t) => {
  const session = fixture();
  let writes = 0,
    conflict = true,
    reads = 0;
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) => {
      if (init?.method === "PUT") {
        writes++;
        if (conflict) throw new ApiError(409, "", "VERSION_CONFLICT");
      }
      return response({
        ...session,
        title: ++reads > 1 ? "Remote title" : session.title,
        version: 2,
      });
    }),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "Draft" }));
  assert.equal(await controller.save(), false);
  controller.retry();
  await tick();
  assert.equal(writes, 1);
  assert.equal(controller.getSnapshot().status, "conflict");
  assert.equal(controller.getSnapshot().session?.title, "Draft");
  conflict = false;
  await controller.load();
  assert.equal(controller.getSnapshot().status, "saved");
});

test("CAS retries merge independent remote edits and save against the latest version", async (t) => {
  const session = fixture();
  let current = session,
    writes = 0;
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) => {
      if (init?.method !== "PUT") return response(current);
      const input = JSON.parse(init.body as string);
      writes++;
      if (writes === 1) {
        current = {
          ...session,
          description: "Concurrent remote note",
          version: 2,
        };
        throw new ApiError(409, "", "VERSION_CONFLICT");
      }
      assert.equal(input.version, 2);
      assert.equal(input.session.description, "Concurrent remote note");
      current = { ...current, ...input.session, version: 3 };
      return response(current);
    }),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "Local title" }));
  assert.equal(await controller.save(), true);
  assert.equal(writes, 2);
  assert.equal(
    controller.getSnapshot().session?.description,
    "Concurrent remote note",
  );
  assert.equal(controller.getSnapshot().session?.title, "Local title");
});

test("polling merges remote fields while preserving incomplete local drafts and flags same-field conflicts", async (t) => {
  const session = fixture();
  let current = session;
  const controller = new SessionController(
    session.id,
    fakeApi(async () => response(current)),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "" }));
  current = { ...session, description: "Remote description", version: 2 };
  await controller.poll();
  assert.equal(controller.getSnapshot().session?.title, "");
  assert.equal(
    controller.getSnapshot().session?.description,
    "Remote description",
  );
  assert.equal(controller.getSnapshot().status, "unsaved");
  current = { ...current, title: "Remote title", version: 3 };
  await controller.poll();
  assert.equal(controller.getSnapshot().status, "conflict");
  assert.equal(controller.getSnapshot().session?.title, "");
});

test("continuously changing remote versions stop automatic retries after two rebases", async (t) => {
  const session = fixture();
  let reads = 0,
    writes = 0;
  const controller = new SessionController(
    session.id,
    fakeApi(async (_path, init) => {
      if (init?.method === "PUT") {
        writes++;
        throw new ApiError(409, "", "VERSION_CONFLICT");
      }
      reads++;
      return response({
        ...session,
        description: `Remote edit ${reads}`,
        version: reads,
      });
    }),
    100000,
  );
  t.after(() => controller.dispose());
  await controller.load();
  controller.update((value) => ({ ...value, title: "Local title" }));
  assert.equal(await controller.save(), false);
  assert.equal(writes, 3);
  assert.equal(controller.getSnapshot().status, "unsaved");
  assert.equal(controller.getSnapshot().session?.title, "Local title");
  await tick();
  assert.equal(writes, 3);
});

function runningFixture() {
  const session = fixture();
  session.days[0].blocks.forEach((block) => {
    block.duration = 2;
  });
  session.sound = { ...session.sound, mode: "minutes", value: 1, atEnd: true };
  return transitionRun(session, "start", { autoAdvance: true }, 1000);
}
test("audio warnings fire once per block, and a revisited block warns when its resumed countdown crosses the threshold", () => {
  const session = runningFixture();
  let frame = timerAudioStep(null, session, 1000, true).frame;
  // Leave the two-minute block after 30 seconds, before its one-minute warning.
  const next = transitionRun(session, "next", {}, 31000);
  frame = timerAudioStep(frame, next, 31000, true).frame;
  const back = transitionRun(next, "previous", {}, 41000);
  frame = timerAudioStep(frame, back, 41000, true).frame;
  // The detour counts: 40 s elapsed, so the warning is due 20 s later.
  const early = timerAudioStep(frame, back, 60000, true);
  assert.equal(early.warning, false);
  const warned = timerAudioStep(early.frame, back, 62000, true);
  assert.equal(warned.warning, true);
  assert.equal(timerAudioStep(warned.frame, back, 63000, true).warning, false);
});

test("revisiting a block already past its warning does not replay it", () => {
  const session = runningFixture();
  let frame = timerAudioStep(null, session, 1000, true).frame;
  const first = timerAudioStep(frame, session, 62000, true);
  assert.equal(first.warning, true);
  frame = first.frame;
  const next = transitionRun(session, "next", {}, 65000);
  frame = timerAudioStep(frame, next, 65000, true).frame;
  const back = transitionRun(next, "previous", {}, 66000);
  frame = timerAudioStep(frame, back, 66000, true).frame;
  assert.equal(timerAudioStep(frame, back, 67000, true).warning, false);
  assert.equal(timerAudioStep(frame, back, 90000, true).warning, false);
});

test("audio catches an auto-advance boundary that occurred between local ticks", () => {
  const session = runningFixture();
  const frame = timerAudioStep(null, session, 120800, true).frame;
  const advanced = transitionRun(session, "sync", {}, 121050);
  const heard = timerAudioStep(frame, advanced, 121050, true);
  assert.equal(heard.end, true);
  assert.equal(timerAudioStep(heard.frame, advanced, 121100, true).end, false);
});

test("a paused block extended before being revisited warns again at its new threshold", () => {
  const session = runningFixture();
  const initial = timerAudioStep(null, session, 1000, true).frame;
  let frame = timerAudioStep(initial, session, 62000, true).frame;
  const paused = transitionRun(session, "pause", {}, 65000);
  frame = timerAudioStep(frame, paused, 65000, true).frame;
  const next = transitionRun(paused, "next", {}, 66000);
  // The facilitator gives the first block one more minute, then returns to it.
  const edited = structuredClone(next);
  edited.days[0].blocks[0].duration = 3;
  const back = transitionRun(edited, "previous", {}, 67000);
  frame = timerAudioStep(frame, back, 67000, true).frame;
  const resumed = transitionRun(back, "resume", {}, 68000);
  frame = timerAudioStep(frame, resumed, 68000, true).frame;
  // 64 s were spent: 116 s remain, and the one-minute warning is 56 s away.
  assert.equal(timerAudioStep(frame, resumed, 123000, true).warning, false);
  assert.equal(timerAudioStep(frame, resumed, 125000, true).warning, true);
});

test("pause/resume and device mute do not replay earlier alerts; session mute overrides device sound", () => {
  const session = runningFixture();
  const initial = timerAudioStep(null, session, 1000, true).frame;
  const muted = timerAudioStep(initial, session, 62000, false);
  assert.equal(muted.warning, false);
  assert.equal(
    timerAudioStep(muted.frame, session, 63000, true).warning,
    false,
  );
  const paused = transitionRun(session, "pause", {}, 65000);
  const frame = timerAudioStep(muted.frame, paused, 66000, true).frame;
  const resumed = transitionRun(paused, "resume", {}, 75000);
  assert.equal(timerAudioStep(frame, resumed, 76000, true).warning, false);
  assert.equal(
    timerAudioStep(
      initial,
      { ...session, sound: { ...session.sound, enabled: false } },
      62000,
      true,
    ).warning,
    false,
  );
});

test("API errors have French and English messages, with safe unknown-message fallback", () => {
  assert.match(apiMessage("INVALID_CREDENTIALS", "", "fr"), /mot de passe/);
  assert.match(apiMessage("INVALID_CREDENTIALS", "", "en"), /password/);
  assert.equal(
    apiMessage("FUTURE_CODE", "New validation constraint", "en"),
    "New validation constraint",
  );
  assert.doesNotMatch(
    apiMessage("FUTURE_CODE", "Error: secret\n at internal.ts:42", "fr"),
    /secret|internal\.ts/,
  );
});

test("empty DELETE requests carry JSON required by the same-origin mutation guard", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.body, "{}");
    assert.equal(
      new Headers(init?.headers).get("Content-Type"),
      "application/json",
    );
    return new Response(null, { status: 204 });
  };
  assert.equal(
    await requestApi("/sessions/example/members/member", { method: "DELETE" }),
    undefined,
  );
});
