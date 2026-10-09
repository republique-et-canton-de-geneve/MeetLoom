import { expect, test } from "@playwright/test";
import {
  addActivities,
  createSession,
  duration,
  member,
  signIn,
} from "./helpers";

/** Headless Chromium has no always-on-top window: the popup fallback shows
 * the same content. */
const openFloating = async (
  page: import("@playwright/test").Page,
  button: import("@playwright/test").Locator,
) => {
  await page.evaluate(() =>
    Object.defineProperty(window, "documentPictureInPicture", {
      value: undefined,
      configurable: true,
    }),
  );
  const [floating] = await Promise.all([
    page.waitForEvent("popup"),
    button.click(),
  ]);
  return floating;
};

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
  // Next to it, the gap and the plan captured when the timer started.
  const compared = page.locator(".duration-compare").first();
  await expect(compared).toContainText("prévu 5 min");
  await expect(compared.locator(".duration-gap")).toHaveAttribute(
    "data-gap",
    "early",
  );
  await page.getByTitle(/Bloc précédent/).click();
  await expect(page.locator(".timer-bar")).toContainText("Accueil");
  // Five minutes planned: the time already spent is kept, not restarted.
  expect(await remaining(page)).toBeLessThan(5 * 60 - 1);

  // From the always-on-top window, without leaving a slideshow.
  const floating = await openFloating(
    page,
    page.getByTitle("Fenêtre au premier plan"),
  );
  await floating.getByRole("button", { name: "Bloc suivant" }).click();
  await expect(page.locator(".timer-bar")).toContainText("Idées");
  await expect(floating.locator(".timer-content")).toContainText("Idées");
  await floating.getByRole("button", { name: "Bloc précédent" }).click();
  await expect(page.locator(".timer-bar")).toContainText("Accueil");
  await floating.close();

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
  // Visitors follow along; only facilitators get the controls.
  const visitorFloating = await openFloating(
    visitor,
    visitor.locator(".public-floating-button"),
  );
  await expect(visitorFloating.locator(".timer-content")).toContainText(
    "Accueil",
  );
  await expect(visitorFloating.locator(".floating-controls")).toHaveCount(0);
  await expect(visitorFloating.getByRole("button")).toHaveAccessibleName(
    "Ancrer sur un bord de l’écran",
  );
  await visitorFloating.close();

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
  // Every step was played: the day, its section and the session total
  // compare the plan with the time spent.
  const section = page.locator(".agenda-section").filter({
    has: page.getByRole("button", {
      name: "Développer ou replier la section Construire",
    }),
  });
  for (const total of [
    page.locator(".duration-pill"),
    page.locator(".agenda-end"),
    page.locator(".agenda-summary-actual"),
    section.locator(".section-totals"),
  ])
    await expect(total.locator(".run-compare")).toContainText(
      /Prévu \d.*réel \d/,
    );

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
  await expect(page.locator(".duration-pill .run-compare")).toHaveCount(0);
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

test("a session whose timer finished asks to be closed from the dashboard", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await createSession(page, "Bilan E2E");
  await addActivities(page, ["Ouverture", "Conclusion"]);
  await page.getByRole("button", { name: /Animer la séance/ }).click();
  const bar = page.locator(".timer-bar");
  await expect(bar).toContainText("Ouverture");
  await page.getByTitle("Bloc suivant").click();
  await expect(bar).toContainText("Conclusion");
  await page.getByTitle("Bloc suivant").click();
  await expect(bar).toContainText("SÉANCE TERMINÉE");

  await page.goto("/");
  // Other journeys may leave finished sessions: stay on this card.
  const card = page.locator(".session-card", { hasText: "Bilan E2E" });
  const toClose = { name: "Voir les séances à clôturer" };
  // The banner leads to what it counts, whatever filter hides it.
  await page.getByLabel("Mon rôle").selectOption("facilitator");
  await expect(card).toHaveCount(0);
  await page.locator(".closing-summary").getByRole("button", toClose).click();
  await expect(card).toBeVisible();
  // Archived sessions are never to close: the filter does not claim all are.
  await page.getByRole("button", { name: "Archives", exact: true }).click();
  await expect(page.locator(".empty-state h3")).toHaveText(
    "Aucune séance à clôturer ici",
  );
  await page.locator(".empty-state").getByRole("button", toClose).click();
  await card.getByRole("button", { name: /Séance terminée/ }).click();
  await page.getByRole("button", { name: "Clôturer la séance" }).click();
  await expect(
    page.getByText("elle compte désormais dans le rapport"),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByLabel("Activité").selectOption("all");
  await expect(card).toContainText("Clôturée");
  await expect(
    card.getByRole("button", { name: /Séance terminée/ }),
  ).toHaveCount(0);
});

test("while it runs, the agenda follows the current block and the floating window grows with its size", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await page.setViewportSize({ width: 1280, height: 600 });
  const created = await page.request.post("/api/sessions", {
    headers: { Origin: new URL(page.url()).origin },
    data: { title: "Suivi E2E", demo: true },
  });
  const { session } = await created.json();
  await page.goto(`/session/${session.id}`);
  await page.getByRole("button", { name: /Animer la séance/ }).click();
  // The current block comes up under the sticky timer, and stays in view as
  // the run moves on.
  const current = page.locator(".current-block").last();
  await expect(current).toBeInViewport();
  for (let step = 0; step < 3; step++) {
    await page.getByTitle("Bloc suivant").click();
    await expect(
      current.getByRole("textbox", { name: "Titre du bloc" }),
    ).toHaveValue(
      ["Ce qui fonctionne déjà", "Dessiner les prochaines étapes", "Pause"][
        step
      ],
    );
    await expect(current).toBeInViewport();
  }
  // Someone who scrolled away to read elsewhere is left there.
  const scrollY = () => page.evaluate(() => window.scrollY);
  await expect
    .poll(async () => {
      const before = await scrollY();
      await page.waitForTimeout(150);
      return before === (await scrollY());
    })
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(current).not.toBeInViewport();
  const away = await scrollY();
  await page.getByTitle("Bloc suivant").click();
  await expect(
    current.getByRole("textbox", { name: "Titre du bloc" }),
  ).toHaveValue("Choisir une expérimentation");
  await page.waitForTimeout(600);
  expect(await scrollY()).toBe(away);

  // The always-on-top window lays itself out for its shape, larger as it
  // grows.
  const floating = await openFloating(
    page,
    page.getByTitle("Fenêtre au premier plan"),
  );
  const body = floating.locator("body");
  const clock = () =>
    floating
      .locator(".timer-clock strong")
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  await floating.setViewportSize({ width: 1400, height: 60 });
  await expect(body).toHaveAttribute("data-shape", "strip");
  const thin = await clock();
  expect(thin).toBeGreaterThanOrEqual(30);
  await expect(floating.locator(".timer-current strong")).toBeVisible();
  await expect(floating.locator(".timer-delta")).toBeVisible();
  await floating.setViewportSize({ width: 1400, height: 450 });
  await expect(body).toHaveAttribute("data-shape", "box");
  expect(await clock()).toBeGreaterThan(2.5 * thin);
  await floating.setViewportSize({ width: 300, height: 800 });
  await expect(body).toHaveAttribute("data-shape", "column");
  await floating.close();
  await page.getByTitle("Réinitialiser").click();
  await expect(
    page.getByRole("button", { name: /Animer la séance/ }),
  ).toBeVisible();

  // Run on its second day, the session opens on that day, for the team and
  // for visitors, so they follow it there.
  await page.getByTitle("Ajouter un jour").click();
  await addActivities(page, ["Rétrospective", "Suite", "Clôture"]);
  await page.getByRole("button", { name: /Animer la séance/ }).click();
  await expect(page.locator(".timer-bar")).toContainText("Rétrospective");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nom du jour" })).toHaveValue(
    "Jour 2",
  );
  await expect(current).toBeInViewport();
  const shared = await page.request.post(`/api/sessions/${session.id}/shares`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { label: "Suivi", mode: "agenda" },
  });
  const { share } = await shared.json();
  const visitor = await (
    await browser.newContext({ viewport: { width: 1280, height: 600 } })
  ).newPage();
  await visitor.goto(`/s/${share.token}`);
  await expect(visitor.locator(".public-block.is-current")).toBeInViewport();
  await page.getByTitle("Réinitialiser").click();
  await expect(
    page.getByRole("button", { name: /Animer la séance/ }),
  ).toBeVisible();
});
