import { expect, test } from "@playwright/test";
import { member, signIn } from "./helpers";

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

test("a finished session shows no countdown, position or schedule estimate", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await page.getByText("Atelier E2E").first().click();
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
  await page.getByTitle("Réinitialiser").click();
  await expect(
    page.getByRole("button", { name: /Animer la séance/ }),
  ).toBeVisible();
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
  await page.getByTitle("Réinitialiser").click();
  await expect(
    page.getByRole("button", { name: /Animer la séance/ }),
  ).toBeVisible();
});
