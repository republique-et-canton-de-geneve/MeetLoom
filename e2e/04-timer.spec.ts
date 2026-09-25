import { expect, test } from "@playwright/test";
import { duration, member, signIn } from "./helpers";

const remaining = async (page: import("@playwright/test").Page) => {
  const text = await page.locator(".timer-bar .timer-clock strong").innerText();
  const [minutes, seconds] = text.split(":").map(Number);
  return minutes * 60 + seconds;
};

test("facilitating: start, move on, come back where the block was, visitors follow", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await page.getByText("Atelier E2E").first().click();
  await expect(page.locator(".display-time-control")).toBeVisible();
  await page.getByRole("button", { name: /Animer la séance/ }).click();
  await expect(page.locator(".timer-bar")).toContainText("EN CE MOMENT");
  await expect(page.locator(".timer-bar")).toContainText("Accueil");
  await page.waitForTimeout(2500);
  await page.getByTitle("Bloc suivant").click();
  await expect(page.locator(".timer-bar")).toContainText("Idées");
  // The passed block shows its actual duration.
  await expect(page.locator(".actual-duration").first()).toHaveText("< 1 min");
  await page.getByTitle(/Bloc précédent/).click();
  await expect(page.locator(".timer-bar")).toContainText("Accueil");
  // Five minutes planned: the time already spent is kept, not restarted.
  expect(await remaining(page)).toBeLessThan(5 * 60 - 1);

  const sessionId = page.url().split("/").pop();
  const created = await page.request.post(`/api/sessions/${sessionId}/shares`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { label: "Live", mode: "agenda" },
  });
  const { share } = await created.json();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/s/${share.token}`);
  await expect(visitor.locator(".public-live")).toContainText("Accueil");
  await expect(visitor.locator(".public-floating-button")).toBeVisible();

  await page.getByTitle("Pause").click();
  await expect(page.locator(".timer-bar")).toContainText("EN PAUSE");
  await expect(visitor.locator(".public-live")).toContainText("EN PAUSE", {
    timeout: 15_000,
  });
  await page.getByTitle("Réinitialiser").click();
  await expect(
    page.getByRole("button", { name: /Animer la séance/ }),
  ).toBeVisible();
});

test("a finished session shows no countdown, position or schedule estimate, and keeps its initial plan", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await page.getByText("Atelier E2E").first().click();
  const planned = await duration(page, "Idées").inputValue();
  await page.getByRole("button", { name: /Animer la séance/ }).click();
  const bar = page.locator(".timer-bar");
  await expect(bar).toContainText("Accueil");
  for (const next of ["Idées", "Décision"]) {
    await page.getByTitle("Bloc suivant").click();
    await expect(bar).toContainText(next);
  }
  await page.getByTitle("Bloc suivant").click();
  await expect(bar).toContainText("SÉANCE TERMINÉE");
  await expect(bar).not.toContainText("restantes");
  await expect(bar).not.toContainText("Fin prévue");
  await expect(bar).not.toContainText("Dans le temps prévu");
  await expect(bar).not.toContainText(" / 3");

  // "Use actual durations" rewrites the agenda, but the run history keeps
  // the initial plan, which can be put back at any time.
  await page
    .getByRole("button", { name: "Utiliser les durées réelles" })
    .click();
  await page.getByRole("button", { name: "Voir les déroulés" }).click();
  const initial = page.locator(".history-run.is-initial");
  await expect(initial).toContainText("Plan initial");
  await initial.getByText("Détail par étape").click();
  await expect(initial.locator("tr", { hasText: "Idées" })).toContainText(
    `${planned} min`,
  );
  await initial
    .getByRole("button", { name: "Rétablir le plan initial" })
    .click();
  await expect(page.getByText("Plan rétabli dans l’agenda")).toBeVisible();
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
  await page.getByRole("button", { name: "Fermer le panneau" }).click();
  await page.getByTitle("Réinitialiser").click();
  await expect(
    page.getByRole("button", { name: /Animer la séance/ }),
  ).toBeVisible();
  await expect(duration(page, "Idées")).toHaveValue(planned);
});

test("a visitor whose clock is ten minutes fast still sees the right countdown", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await page.getByText("Atelier E2E").first().click();
  await page.getByRole("button", { name: /Animer la séance/ }).click();
  await expect(page.locator(".timer-bar")).toContainText("Accueil");
  const sessionId = page.url().split("/").pop();
  const created = await page.request.post(`/api/sessions/${sessionId}/shares`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { label: "Skewed clock", mode: "agenda" },
  });
  const { share } = await created.json();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.clock.setSystemTime(Date.now() + 10 * 60_000);
  await visitor.goto(`/s/${share.token}`);
  const live = visitor.locator(".public-live");
  await expect(live).toContainText("Accueil");
  // Five minutes planned: without correction the visitor would see five
  // minutes of overtime.
  await expect(live).toContainText("restantes");
  await expect(live).not.toContainText("de dépassement");
  await expect(live.locator(".timer-clock strong")).toHaveText(/^0[34]:\d\d$/);
  // Visitors see when the day should end too.
  await expect(live.locator(".timer-end")).toHaveText(/^Fin prévue \d\d:\d\d$/);
  await page.getByTitle("Réinitialiser").click();
  await expect(
    page.getByRole("button", { name: /Animer la séance/ }),
  ).toBeVisible();
});

test("late and early stand out from on schedule, not only by their wording", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  // Its own session: adding time changes the plan of the block.
  const created = await page.request.post("/api/sessions", {
    headers: { Origin: new URL(page.url()).origin },
    data: { title: "Retard E2E", demo: true },
  });
  const { session } = await created.json();
  await page.goto(`/session/${session.id}`);
  await page.getByRole("button", { name: /Animer la séance/ }).click();
  const schedule = page.locator(".timer-bar .timer-delta");
  await expect(schedule).toHaveAttribute("data-schedule", "on-time");
  await page.getByTitle("Ajouter une minute au bloc").click();
  await expect(schedule).toHaveAttribute("data-schedule", "late");
  await page.getByTitle("Ajouter cinq minutes au bloc").click();
  await expect(schedule).toHaveAttribute("data-schedule", "very-late");
  await expect(schedule).toContainText("6 min de retard");
  // The day's expected end and the total time left sit next to it.
  await expect(page.locator(".timer-bar .timer-end")).toHaveText(
    /^Fin prévue \d\d:\d\d$/,
  );
  await expect(page.locator(".timer-bar .timer-left")).toContainText("reste");
  await page.getByTitle("Réinitialiser").click();
});
