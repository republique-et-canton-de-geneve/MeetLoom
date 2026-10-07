import { expect, test, type Locator } from "@playwright/test";
import {
  addActivities,
  createSession,
  duration,
  member,
  setDuration,
  signIn,
} from "./helpers";

test("editing an agenda saves blocks, durations, groups and sections across reloads", async ({
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
  // A section inserted above a block gathers it and the blocks that follow.
  await page
    .locator(".block-group")
    .filter({ has: duration(page, "Idées") })
    .locator("> .insert-slot")
    .click();
  await page.getByRole("menuitem", { name: /^Section/ }).click();
  const section = page.locator(".agenda-section");
  await expect(section).toHaveCount(1);
  for (const [title, inside] of [
    ["Accueil", 0],
    ["Idées", 1],
    ["Décision", 1],
  ] as const)
    await expect(section.filter({ has: duration(page, title) })).toHaveCount(
      inside,
    );
  const heading = section.locator(".section-title");
  await expect(heading).toBeFocused();
  await expect(heading).toHaveValue("Nouvelle section");
  await heading.fill("Construire");
  // Clicking one of its blocks names the section and keeps that block's focus.
  const decision = page
    .locator(".agenda-row")
    .filter({ has: duration(page, "Décision") })
    .getByRole("textbox", { name: "Titre du bloc" });
  await decision.click();
  await expect(decision).toBeFocused();
  await expect(heading).toHaveValue("Construire");
  await expect(section.locator(".section-totals")).toContainText("35 min");
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
  await page.reload();
  await expect(page.locator(".section-title")).toHaveValue("Construire");
  await expect(
    page.getByRole("button", {
      name: "Développer ou replier la section Construire",
    }),
  ).toHaveAttribute("aria-expanded", "true");
  // A block dropped where it already is leaves nothing to undo.
  await page
    .locator(".agenda-row")
    .filter({ has: duration(page, "Idées") })
    .locator(".drag-handle")
    .dragTo(page.locator(".section-totals"));
  await expect(page.getByTitle("Annuler", { exact: true })).toBeDisabled();
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

test("the sidebar gives the folders the height left, and scrolls when zoomed in", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  const sidebar = page.locator(".sidebar");
  const height = async (selector: string) =>
    (await sidebar.locator(selector).boundingBox())?.height ?? 0;
  // A desktop window about 900 px tall: the folders take what the
  // navigation leaves, and the account footer shows the avatar beside the name.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect
    .poll(() => height(".dashboard-folders"))
    .toBeGreaterThanOrEqual(220);
  const avatar = (await sidebar
    .locator(".sidebar-user .avatar")
    .boundingBox())!;
  const name = (await sidebar.locator(".sidebar-user strong").boundingBox())!;
  expect(name.x).toBeGreaterThanOrEqual(avatar.x + avatar.width);
  // No placeholder card without a workspace; the hint shows only in "all",
  // the one view where folders cannot be managed.
  const card = sidebar.locator(".workspace-card");
  const hint = sidebar.locator(".folder-note");
  await expect(card).toHaveCount(0);
  await expect(hint).toHaveText(
    "Sélectionnez un espace pour gérer les dossiers.",
  );
  await page.locator("#workspace-switcher").selectOption("personal");
  await expect(hint).toHaveCount(0);
  await expect(card).toHaveCount(0);
  // A narrower window: no height cap, and the name wraps instead of being cut.
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect
    .poll(() => height(".dashboard-folders"))
    .toBeGreaterThanOrEqual(250);
  expect(
    await sidebar
      .locator(".sidebar-user strong")
      .evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth &&
          element.scrollHeight <= element.clientHeight,
      ),
  ).toBe(true);
  // A laptop browser zoomed to 150% leaves about this much room.
  await page.setViewportSize({ width: 900, height: 480 });
  expect(await height(".dashboard-folders")).toBeGreaterThanOrEqual(150);
  for (const target of [
    sidebar.getByRole("button", { name: "Signaler un problème" }),
    sidebar.locator(".sidebar-user"),
  ]) {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport({ ratio: 0.9 });
  }
  // The editor's sidebar too: contents, duration and account.
  await page.getByText("Atelier E2E").first().click();
  await expect(page.locator(".display-time-control")).toBeVisible();
  const footer = page.locator(".sidebar .sidebar-user");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport({ ratio: 0.9 });
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
  // Each checkbox sits on its text's line, not above it; the open session
  // comes first, ticked, and the count follows the selection.
  const sameLine = async (box: Locator, text: Locator) => {
    const b = (await box.boundingBox())!,
      s = (await text.boundingBox())!;
    expect(s.x).toBeGreaterThanOrEqual(b.x + b.width);
    expect(s.y).toBeLessThan(b.y + b.height);
  };
  const current = page.locator(".mcp-session-list .checkbox-row").first();
  await expect(current).toContainText("Atelier E2E");
  await expect(current).toContainText("Séance actuelle");
  await expect(current.getByRole("checkbox")).toBeChecked();
  await sameLine(current.getByRole("checkbox"), current.locator("strong"));
  const write = page.getByRole("checkbox", {
    name: "Autoriser les modifications et la création de jours",
  });
  await sameLine(
    write,
    page.locator("label", { has: write }).locator("strong"),
  );
  await expect(write).toHaveAccessibleDescription(/historique/);
  await expect(page.getByText(/^1 séance sélectionnée sur \d+$/)).toBeVisible();
  await current.getByRole("checkbox").uncheck();
  await expect(page.getByText(/^0 séance sélectionnée sur \d+$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /Exporter/ })
    .first()
    .click();
  await expect(page.getByText(/avec l’IA interne/)).toHaveCount(0);
  // The block filter's compact rows leave room before the note under them.
  await page.getByText("Filtrer les blocs et catégories").click();
  const last = page.locator(".slide-outline > .checkbox-row").last();
  await expect(last).toBeVisible();
  const row = (await last.boundingBox())!,
    note = (await page
      .getByText(/^Les groupes nécessaires restent/)
      .boundingBox())!;
  expect(note.y - (row.y + row.height)).toBeGreaterThanOrEqual(8);
});
