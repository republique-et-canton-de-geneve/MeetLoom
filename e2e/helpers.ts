import { expect, type Browser, type Page } from "@playwright/test";

export const password = "e2e-correct-horse-battery";
export const admin = { name: "Alex Admin", email: "alex@example.test" };
export const member = { name: "Camille Membre", email: "camille@example.test" };

/** A fresh browser context signed in with the given account. */
export async function signIn(
  browser: Browser,
  account: { email: string },
): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.locator("input[name=email]").fill(account.email);
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: /Se connecter/ }).click();
  await expect(page.locator("#workspace-switcher")).toBeVisible();
  return page;
}

/** Creates a session from the dashboard and waits for its editor. */
export async function createSession(page: Page, title: string) {
  await page
    .getByRole("button", { name: /Nouvelle séance/ })
    .first()
    .click();
  await page.getByPlaceholder(/Atelier vision/).fill(title);
  await page.getByRole("button", { name: /Créer la séance/ }).click();
  await expect(page.locator(".display-time-control")).toBeVisible();
}

/** Adds activities by typing titles, pressing Enter between them. */
export async function addActivities(page: Page, titles: string[]) {
  await page.getByRole("button", { name: /Ajouter le premier bloc/ }).click();
  for (const [index, title] of titles.entries()) {
    if (index) await page.keyboard.press("Enter");
    await page.keyboard.type(title);
  }
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
}

export const duration = (page: Page, title: string) =>
  page.getByRole("textbox", { name: `Durée de ${title}`, exact: true });

export async function setDuration(page: Page, title: string, minutes: number) {
  const field = duration(page, title);
  await field.fill(String(minutes));
  await field.press("Tab");
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
}
