import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveFilename } from "../src/archive-filename.ts";

test("encrypted downloads keep their dated name with either HTTP filename syntax", () => {
  const name = "meetloom-2026-10-26-18-00.mldx";
  assert.equal(archiveFilename(`attachment; filename="${name}"`), name);
  assert.equal(archiveFilename(`attachment; filename=${name}`), name);
  assert.equal(archiveFilename(`attachment; filename=${name}; size=123`), name);
});

test("an absent filename keeps the archive fallback", () => {
  for (const header of [
    null,
    "",
    "attachment",
    'attachment; filename=""',
    "attachment; filename=",
    "attachment; otherfilename=wrong.mldx",
  ]) {
    assert.equal(archiveFilename(header), "meetloom.mldx");
  }
});
