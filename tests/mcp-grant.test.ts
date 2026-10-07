import test from "node:test";
import assert from "node:assert/strict";
import type { Role, SessionSummary } from "../shared/model.js";
import {
  canGrantWrite,
  mcpSessionChoices,
  mcpTokenCheck,
} from "../src/mcp-grant.ts";

const summary = (id: string, role: Role = "owner"): SessionSummary => ({
  id,
  title: id.toUpperCase(),
  description: "",
  updatedAt: "2026-10-01T08:00:00Z",
  days: 1,
  duration: 60,
  blocks: 3,
  role,
  archived: false,
});
const ids = (sessions: SessionSummary[]) => sessions.map((s) => s.id);

test("the connector picker lists the open session first and keeps the server order otherwise", () => {
  const sessions = [summary("a"), summary("b"), summary("c")];
  assert.deepEqual(ids(mcpSessionChoices(sessions, "c")), ["c", "a", "b"]);
  assert.deepEqual(ids(mcpSessionChoices(sessions, "b")), ["b", "a", "c"]);
  assert.deepEqual(ids(mcpSessionChoices(sessions, "zz")), ["a", "b", "c"]);
  assert.deepEqual(ids(sessions), ["a", "b", "c"]);
});

test("a write grant is held back when a selected session is read-only for the user", () => {
  const sessions = [
    summary("a", "owner"),
    summary("b", "viewer"),
    summary("c", "facilitator"),
    summary("d", "editor"),
  ];
  const check = (selected: string[], write: boolean, label = "Client IA") =>
    mcpTokenCheck({ label, selected, write }, sessions);
  assert.deepEqual(check(["a", "d"], true), { readOnly: 0, ready: true });
  assert.deepEqual(check(["a", "b", "c", "zz"], true), {
    readOnly: 2,
    ready: false,
  });
  // Read-only sessions only matter when write access is asked.
  assert.deepEqual(check(["a", "b", "c"], false), { readOnly: 0, ready: true });
  // A client name and at least one session stay required.
  assert.equal(check(["a"], false, "  ").ready, false);
  assert.equal(check([], false).ready, false);
  for (const role of ["owner", "editor"] as Role[])
    assert.equal(canGrantWrite(role), true, role);
  for (const role of ["facilitator", "viewer"] as Role[])
    assert.equal(canGrantWrite(role), false, role);
});
