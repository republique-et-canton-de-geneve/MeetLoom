import { expect, test } from "@playwright/test";
import {
  addActivities,
  createSession,
  duration,
  member,
  setDuration,
  signIn,
} from "./helpers";

test("editing an agenda saves blocks, durations and groups across reloads", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await createSession(page, "Atelier E2E");
  await addActivities(page, ["Accueil", "Idées", "Décision"]);
  await setDuration(page, "Accueil", 5);
  await setDuration(page, "Idées", 20);
  await setDuration(page, "Décision", 15);
  await expect(page.locator(".agenda-summary strong")).toHaveText("40 min");
  // Insert a group between two blocks from the insert line.
  const second = page.locator(".block-group").nth(1);
  await second.locator("> .insert-slot").click();
  await page.getByRole("menuitem", { name: /Groupe/ }).click();
  await expect(page.locator(".container-group")).toHaveCount(1);
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
  await page.reload();
  await expect(duration(page, "Idées")).toHaveValue("20");
  await expect(page.locator(".container-group .container-title")).toHaveValue(
    "Nouveau groupe",
  );
  await expect(page.locator(".agenda-summary strong")).toHaveText("40 min");
});
