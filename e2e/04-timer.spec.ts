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
