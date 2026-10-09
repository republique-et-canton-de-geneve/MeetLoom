import { test } from "node:test";
import assert from "node:assert/strict";
import { keptText, typedAgainst } from "../src/text-input.ts";
import { normalizeFolder } from "../shared/folders.ts";

test("a saved copy that only trims what is being typed keeps the typed text", () => {
  // "Acme " is saved as "Acme" while the person pauses before the next word.
  assert.equal(keptText("Acme ", "Acme"), "Acme ");
  assert.equal(keptText("  Acme", "Acme"), "  Acme");
  assert.equal(keptText("Acme Corp", "Acme Corp"), "Acme Corp");
});

test("a real change from elsewhere replaces the typed text", () => {
  assert.equal(keptText("Acme ", "Beta"), "Beta");
  assert.equal(keptText("Acme ", ""), "");
});

test("a field that is not being typed in shows the saved value", () => {
  assert.equal(keptText(null, "Acme"), "Acme");
});

test("folder paths keep a trailing slash until the next part is typed", () => {
  assert.equal(keptText("Clients/", "Clients", normalizeFolder), "Clients/");
  assert.equal(
    keptText("Clients / ", "Clients", normalizeFolder),
    "Clients / ",
  );
  assert.equal(keptText("Clients/", "Projets", normalizeFolder), "Projets");
});

test("a real change from elsewhere drops the typed text for good", () => {
  // Codex review: "Acme " kept, a collaborator writes "Beta", then "Acme"
  // again: the stale trailing space must not come back.
  let typed: string | null = "Acme ";
  typed = typedAgainst(typed, "Beta");
  assert.equal(typed, null);
  assert.equal(keptText(typed, "Acme"), "Acme");
  assert.equal(typedAgainst("Acme ", "Acme"), "Acme ");
});
