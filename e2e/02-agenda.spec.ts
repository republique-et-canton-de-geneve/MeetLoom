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

test("Escape closes the actions menu and side panels, and returns focus", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await createSession(page, "Atelier clavier");
  await addActivities(page, ["Accueil"]);
  const more = page.getByRole("button", { name: "Autres actions" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".dropdown-menu")).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.locator("button.expand-block").first().click();
  await expect(page.locator(".editor-inspector")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-inspector")).toHaveCount(0);
  await expect(page.locator("button.expand-block").first()).toBeFocused();
  // The facilitator picker closes on a click anywhere else.
  const picker = page.locator(".assignee-picker").first();
  await picker.locator("summary").click();
  await expect(picker.locator(".assignee-menu")).toBeVisible();
  await page.locator(".agenda-summary").click();
  await expect(picker.locator(".assignee-menu")).toBeHidden();
});

test("a day is deleted from the overview, but never the last one", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await createSession(page, "Atelier deux jours");
  await addActivities(page, ["Ouverture"]);
  await page.getByRole("button", { name: "Autres actions" }).click();
  await page.getByRole("button", { name: "Dupliquer ce jour" }).click();
  await page.getByRole("button", { name: "Vue d’ensemble" }).first().click();
  const days = page.locator(".overview-day");
  await expect(days).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await days
    .nth(1)
    .getByRole("button", { name: /^Supprimer / })
    .click();
  await expect(days).toHaveCount(1);
  await expect(
    days.first().getByRole("button", { name: /^Supprimer / }),
  ).toBeDisabled();
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
});

test("agenda contents show they can be reordered, and where a dragged item lands", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await createSession(page, "Atelier ordre");
  await page.getByRole("button", { name: "Page", exact: true }).click();
  const rows = page.locator(".session-navigation .content-nav-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).locator(".content-nav-grip")).toHaveCount(1);
  // Drop on the top half of the day: the page goes before it.
  const day = rows.nth(0).locator(".nav-item");
  const box = (await day.boundingBox())!;
  await rows
    .nth(1)
    .locator(".nav-item")
    .dragTo(day, { targetPosition: { x: box.width / 2, y: 3 } });
  await expect(rows.nth(0)).toContainText("Nouvelle page");
  await expect(rows.nth(1)).toContainText("Jour 1");
  await expect(page.locator(".content-nav-row.drop-before")).toHaveCount(0);

  // A session feedback form (ROTI + comment) is one click away.
  await page.getByRole("button", { name: "Feedback (ROTI)" }).click();
  await expect(rows.nth(2)).toContainText("Feedback de la séance");
  await expect(
    page.locator(
      'input[value="Ce temps passé ensemble en valait-il la peine ? (ROTI)"]',
    ),
  ).toBeVisible();
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
});

test("on a phone the editor fits the screen and days keep their names", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Atelier E2E").first().click();
  await expect(page.locator(".display-time-control")).toBeVisible();
  const navigation = page.locator(".session-navigation nav");
  await expect(navigation.getByText("Jour 1")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("without a configured LLM no AI feature shows, and MCP connectors stay reachable", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await page.getByText("Atelier E2E").first().click();
  await expect(page.locator(".display-time-control")).toBeVisible();
  await expect(page.getByRole("button", { name: "Assistant IA" })).toHaveCount(
    0,
  );
  await page.locator("button.expand-block").first().click();
  await expect(page.locator(".editor-inspector")).toBeVisible();
  await expect(page.getByText("Aide IA pour ce bloc")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Autres actions" }).click();
  await page.getByRole("button", { name: /Connecteurs IA \(MCP\)/ }).click();
  await expect(page.locator(".editor-inspector")).toContainText(
    "Connecteur MCP interne",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /Exporter/ })
    .first()
    .click();
  await expect(page.getByText(/avec l’IA interne/)).toHaveCount(0);
});
