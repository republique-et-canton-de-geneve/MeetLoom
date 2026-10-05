import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Instructions of one Dockerfile stage, continuation lines joined.
function stage(name: string) {
  const instructions = readFileSync("Dockerfile", "utf8")
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const start = instructions.findIndex((line) =>
    new RegExp(`^FROM \\S+ AS ${name}$`, "i").test(line),
  );
  assert.notEqual(start, -1, `the Dockerfile has a ${name} stage`);
  const end = instructions.findIndex(
    (line, index) => index > start && /^FROM /i.test(line),
  );
  return instructions.slice(start, end === -1 ? undefined : end);
}

// The Security workflow's Trivy scan is the real gate, but it turns green
// without this step whenever the Node.js image catches up with Debian; this
// keeps the step from being dropped then.
test("the runtime image takes Debian security fixes the Node.js base image has not shipped yet", () => {
  const runtime = stage("runtime");
  const upgrade = runtime.findIndex((line) =>
    /^RUN apt-get update .*apt-get upgrade -y/.test(line),
  );
  assert.notEqual(upgrade, -1, "the runtime stage upgrades its packages");
  assert.match(
    runtime[upgrade],
    /rm -rf \/var\/lib\/apt\/lists/,
    "the package index stays out of the image",
  );
  const user = runtime.findIndex((line) => /^USER /.test(line));
  assert.notEqual(user, -1, "the runtime stage drops root");
  assert.ok(upgrade < user, "packages are upgraded before dropping root");
});
