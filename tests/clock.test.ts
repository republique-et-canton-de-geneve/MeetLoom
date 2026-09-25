import test from "node:test";
import assert from "node:assert/strict";
import { recordServerTime, serverNow } from "../src/clock.js";

const response = (serverTime: number | string | null) => ({
  headers: new Headers(
    serverTime === null ? {} : { "X-Server-Time": String(serverTime) },
  ),
});

test("the browser follows the server clock from the fastest recent exchange", () => {
  const local = Date.now();
  // Server ten minutes ahead, measured over a 200 ms round trip.
  recordServerTime(response(local + 600_000 + 100), local, local + 200);
  assert.ok(Math.abs(serverNow() - (Date.now() + 600_000)) < 50);
  // A slower exchange with a noisier reading does not replace it.
  recordServerTime(response(local + 900_000), local, local + 2_000);
  assert.ok(Math.abs(serverNow() - (Date.now() + 600_000)) < 50);
  // Missing or invalid headers are ignored.
  recordServerTime(response(null), local, local + 10);
  recordServerTime(response("soon"), local, local + 10);
  assert.ok(Math.abs(serverNow() - (Date.now() + 600_000)) < 50);
  // A faster exchange refines it.
  recordServerTime(response(local + 5 + 30_000), local, local + 10);
  assert.ok(Math.abs(serverNow() - (Date.now() + 30_000)) < 50);
  // After a minute any sample replaces the old one: a clock fixed
  // mid-session is followed.
  const later = local + 61_000;
  recordServerTime(response(later + 500), later, later + 1_000);
  assert.ok(Math.abs(serverNow() - Date.now()) < 50);
});
