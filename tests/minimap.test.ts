import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createSession,
  newBlock,
  totalDuration,
  transitionRun,
} from "../shared/domain.js";
import { INITIAL_RUN, type Block, type Session } from "../shared/model.js";
import {
  categoryMinutes,
  minimapItems,
  openAncestors,
  revealScrollTop,
  type MinimapItem,
} from "../src/minimap.ts";
import AgendaMinimap from "../src/AgendaMinimap.tsx";

const day = (blocks: Block[]) => ({ id: "day-1", startTime: "09:00", blocks });
const group = (title: string, children: Block[], category = "discussion") =>
  newBlock("fr", { title, kind: "group", category, children });
const activity = (title: string, duration: number, category = "activity") =>
  newBlock("fr", { title, duration, category });
/** Every item of the map, containers and room contents included. */
const flatten = (items: MinimapItem[]): MinimapItem[] =>
  items.flatMap((item) => [
    item,
    ...flatten(item.children),
    ...item.rooms.flatMap((room) => flatten(room.items)),
  ]);
const statuses = (items: MinimapItem[]) =>
  Object.fromEntries(
    flatten(items).map((item) => [item.block.title, item.status]),
  );

test("the minimap draws a group's activities inside it with their own categories, start times and durations", () => {
  const children = [
    activity("Préparation individuelle", 5),
    activity("Sélection des propositions", 17),
    activity("Vote des propositions", 32),
    activity("Vie du contrat", 16, "decision"),
  ];
  const contract = group("Définition contrat d’équipe", children);
  const items = minimapItems(
    day([
      activity("Ouverture", 10, "opening"),
      contract,
      activity("Clôture", 5, "closing"),
    ]),
    INITIAL_RUN,
  );
  assert.equal(items.length, 3);
  const inside = items[1].children;
  assert.deepEqual(
    inside.map((item) => item.block.category),
    ["activity", "activity", "activity", "decision"],
  );
  assert.deepEqual(
    inside.map((item) => item.minutes),
    [5, 17, 32, 16],
  );
  assert.deepEqual(
    inside.map((item) => item.startMinute),
    [550, 555, 572, 604],
  );
  assert.equal(items[1].minutes, 70);
  assert.equal(
    items[1].minutes,
    inside.reduce((sum, item) => sum + item.minutes, 0),
  );
  assert.deepEqual(inside[0].ancestors, [{ id: contract.id }]);
  assert.deepEqual(
    items.map((item) => item.ancestors),
    [[], [], []],
  );
  assert.ok(flatten(items).every((item) => item.status === "idle"));
});

test("notes, zero-minute activities and empty containers stay on the map", () => {
  const note = newBlock("fr", {
    title: "Note",
    kind: "note",
    category: "decision",
  });
  const parallel = newBlock("fr", {
    title: "P",
    kind: "parallel",
    rooms: [{ id: "room-1", title: "Salle 1", blocks: [] }],
  });
  const items = minimapItems(
    day([
      activity("A", 30),
      note,
      activity("Zéro", 0),
      group("Vide", []),
      parallel,
    ]),
    INITIAL_RUN,
  );
  assert.equal(items.length, 5);
  assert.deepEqual(
    items.slice(1).map((item) => item.minutes),
    [0, 0, 0, 0],
  );
  assert.deepEqual(items[3].children, []);
  assert.equal(items[4].rooms.length, 1);
  assert.deepEqual(items[4].rooms[0].items, []);
  assert.equal(items[1].block.category, "decision");
});

test("nested groups and parallel rooms stay a tree with the containers to open for each block", () => {
  const x = activity("x", 4),
    y = activity("y", 6),
    z = activity("z", 3);
  const inner = group("inner", [x]),
    g2 = group("g2", [y]);
  const parallel = newBlock("fr", {
    title: "P",
    kind: "parallel",
    rooms: [
      { id: "R1", title: "Salle 1", blocks: [g2] },
      { id: "R2", title: "Salle 2", blocks: [z] },
    ],
  });
  const outer = group("outer", [inner, parallel]);
  const [item] = minimapItems(day([outer]), INITIAL_RUN);
  const [innerItem, parallelItem] = item.children;
  assert.deepEqual(
    parallelItem.rooms.map((room) => [room.id, room.title]),
    [
      ["R1", "Salle 1"],
      ["R2", "Salle 2"],
    ],
  );
  assert.equal(parallelItem.minutes, 6);
  assert.equal(
    parallelItem.minutes,
    Math.max(...parallelItem.rooms.map((room) => room.minutes)),
  );
  assert.equal(parallelItem.rooms[1].minutes, 3);
  assert.deepEqual(innerItem.children[0].ancestors, [
    { id: outer.id },
    { id: inner.id },
  ]);
  assert.deepEqual(parallelItem.rooms[0].items[0].children[0].ancestors, [
    { id: outer.id },
    { id: parallel.id, roomId: "R1" },
    { id: g2.id },
  ]);
  assert.deepEqual(parallelItem.rooms[1].items[0].ancestors, [
    { id: outer.id },
    { id: parallel.id, roomId: "R2" },
  ]);
});

test("during a run each step inside a group is done, current or upcoming, and the map is plain once the run ends", () => {
  let session: Session = createSession("owner", "Run", "fr");
  const a = activity("a", 5),
    b = activity("b", 5),
    c = activity("c", 5),
    d = activity("d", 5);
  const note = newBlock("fr", { title: "note", kind: "note" });
  session.days[0].blocks = [group("G", [a, b, note, c]), d];
  const dayId = session.days[0].id;
  const map = () => statuses(minimapItems(session.days[0], session.run));
  session = transitionRun(session, "start", { dayId, blockId: a.id }, 1000);
  session = transitionRun(session, "next", {}, 61_000);
  assert.deepEqual(map(), {
    G: "current",
    a: "done",
    b: "current",
    note: "idle",
    c: "upcoming",
    d: "upcoming",
  });
  session = transitionRun(session, "pause", {}, 91_000);
  assert.equal(map().b, "current");
  session = transitionRun(session, "previous", {}, 92_000);
  assert.equal(map().a, "current");
  assert.equal(map().b, "upcoming");
  for (const at of [93_000, 94_000, 95_000])
    session = transitionRun(session, "next", {}, at);
  assert.deepEqual(map(), {
    G: "done",
    a: "done",
    b: "done",
    note: "idle",
    c: "done",
    d: "current",
  });
  const running = session.run;
  session = transitionRun(session, "next", {}, 96_000);
  assert.equal(session.run.status, "finished");
  assert.ok(Object.values(map()).every((status) => status === "idle"));
  assert.ok(
    Object.values(
      statuses(minimapItems(session.days[0], { ...running, dayId: "other" })),
    ).every((status) => status === "idle"),
  );
});

test("activities inside parallel rooms follow their parallel step without being individually current", () => {
  let session: Session = createSession("owner", "Rooms", "fr");
  const parallel = newBlock("fr", {
    title: "P",
    kind: "parallel",
    rooms: [
      {
        id: "R1",
        title: "Salle 1",
        blocks: [
          activity("r1", 5),
          group("g2", [activity("y", 4)]),
          newBlock("fr", { title: "n", kind: "note" }),
        ],
      },
      { id: "R2", title: "Salle 2", blocks: [activity("r2", 3)] },
    ],
  });
  session.days[0].blocks = [parallel, activity("d", 5)];
  const map = () => statuses(minimapItems(session.days[0], session.run));
  session = transitionRun(session, "start", {}, 1000);
  assert.deepEqual(map(), {
    P: "current",
    r1: "upcoming",
    g2: "upcoming",
    y: "upcoming",
    n: "idle",
    r2: "upcoming",
    d: "upcoming",
  });
  session = transitionRun(session, "next", {}, 61_000);
  // Groups inside a room follow the parallel step down to their activities.
  assert.deepEqual(map(), {
    P: "done",
    r1: "done",
    g2: "done",
    y: "done",
    n: "idle",
    r2: "done",
    d: "current",
  });
});

test("the category bar counts activities inside groups and the longest room of a parallel block", () => {
  const blocks = [
    group("G", [
      activity("A", 5),
      activity("B", 16, "decision"),
      newBlock("fr", { title: "N", kind: "note", category: "closing" }),
    ]),
    newBlock("fr", {
      title: "P",
      kind: "parallel",
      category: "discussion",
      rooms: [
        { id: "R1", title: "Salle 1", blocks: [activity("C", 10)] },
        {
          id: "R2",
          title: "Salle 2",
          blocks: [activity("D", 4, "break"), activity("E", 2, "closing")],
        },
      ],
    }),
  ];
  const minutes = categoryMinutes(blocks);
  assert.equal(minutes.get("activity"), 15);
  assert.equal(minutes.get("decision"), 16);
  for (const category of ["discussion", "break", "closing"])
    assert.equal(minutes.has(category), false, category);
  const sum = [...minutes.values()].reduce((total, n) => total + n, 0);
  assert.equal(sum, totalDuration({ days: [{ blocks }] }));
  assert.equal(sum, 31);
  // Rooms of the same length: only the first one counts.
  const tie = newBlock("fr", {
    title: "T",
    kind: "parallel",
    rooms: [
      { id: "R1", title: "Salle 1", blocks: [activity("F", 5)] },
      { id: "R2", title: "Salle 2", blocks: [activity("H", 5, "break")] },
    ],
  });
  assert.deepEqual([...categoryMinutes([tie])], [["activity", 5]]);
});

test("a jump opens the collapsed groups and selects the room tabs that hold the block", () => {
  const y = activity("y", 6);
  const g2 = group("g2", [y]);
  const parallel = newBlock("fr", {
    title: "P",
    kind: "parallel",
    rooms: [
      { id: "R1", title: "Salle 1", blocks: [activity("x", 4)] },
      { id: "R2", title: "Salle 2", blocks: [g2] },
    ],
  });
  const outer = group("outer", [parallel]);
  const yItem = flatten(minimapItems(day([outer]), INITIAL_RUN)).find(
    (item) => item.block.id === y.id,
  )!;
  const collapsed = new Set([outer.id, g2.id, "elsewhere"]);
  const roomTabs = { [parallel.id]: "overview", other: "room-9" };
  const open = openAncestors({ collapsed, roomTabs }, yItem.ancestors);
  assert.deepEqual([...open.collapsed], ["elsewhere"]);
  assert.deepEqual(open.roomTabs, { [parallel.id]: "R2", other: "room-9" });
  // The editor's state is replaced, never changed in place.
  assert.equal(collapsed.size, 3);
  assert.equal(roomTabs[parallel.id], "overview");
  const top = openAncestors({ collapsed, roomTabs }, []);
  assert.deepEqual([...top.collapsed], [...collapsed]);
  assert.deepEqual(top.roomTabs, roomTabs);
});

test("the minimap scrolls only when the current step is out of view, and then to its middle", () => {
  const view = { scrollTop: 200, clientHeight: 170 };
  // Visible, even at an edge: no scroll.
  assert.equal(revealScrollTop(view, { top: 220, bottom: 240 }), 200);
  assert.equal(revealScrollTop(view, { top: 200, bottom: 370 }), 200);
  // Below or above: centered, so the steps around it show too.
  assert.equal(revealScrollTop(view, { top: 380, bottom: 400 }), 305);
  assert.equal(revealScrollTop(view, { top: 360, bottom: 380 }), 285);
  assert.equal(revealScrollTop(view, { top: 120, bottom: 140 }), 45);
  assert.equal(revealScrollTop(view, { top: 40, bottom: 60 }), 0);
  // Taller than the view: its start is shown.
  assert.equal(revealScrollTop(view, { top: 400, bottom: 700 }), 400);
});

test("a current parallel block fills top to bottom across its rooms, an activity left to right", () => {
  let session: Session = createSession("owner", "Fill", "fr");
  const parallel = newBlock("fr", {
    title: "P",
    kind: "parallel",
    rooms: [
      { id: "R1", title: "Salle 1", blocks: [activity("r1", 25)] },
      { id: "R2", title: "Salle 2", blocks: [activity("r2", 25)] },
    ],
  });
  session.days[0].blocks = [parallel, activity("d", 5)];
  const html = () =>
    renderToStaticMarkup(
      createElement(AgendaMinimap, {
        session,
        day: session.days[0],
        onJump: () => {},
      }),
    );
  const fill =
    /<i class="minimap-timer-progress[^>]*style="(width|height):([\d.]+)%/g;
  // 10 of 25 minutes: both rooms are 40% through, not room 1 alone.
  session = transitionRun(session, "start", {}, Date.now() - 10 * 60_000);
  const parallelFills = [...html().matchAll(fill)];
  assert.equal(parallelFills.length, 1);
  assert.equal(parallelFills[0][1], "height");
  assert.ok(
    Math.abs(Number(parallelFills[0][2]) - 40) < 1,
    parallelFills[0][2],
  );
  session = transitionRun(session, "next", {}, Date.now());
  const activityFills = [...html().matchAll(fill)];
  assert.equal(activityFills.length, 1);
  assert.equal(activityFills[0][1], "width");
});
