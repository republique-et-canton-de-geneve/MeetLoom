import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

export const password = "e2e-correct-horse-battery";
export const admin = { name: "Alex Admin", email: "alex@example.test" };
export const member = { name: "Camille Membre", email: "camille@example.test" };

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
/** Sign-in cookies per account: journeys reuse them instead of signing in
 * again, which would exhaust the server's sign-in budget (20 attempts per
 * 15 minutes from one address). */
const signedIn = new Map<string, StorageState>();

/** A fresh browser context signed in with the given account. */
export async function signIn(
  browser: Browser,
  account: { email: string },
  { fresh = false } = {},
): Promise<Page> {
  const saved = fresh ? undefined : signedIn.get(account.email);
  const page = await (
    await browser.newContext(saved ? { storageState: saved } : {})
  ).newPage();
  await page.goto("/");
  const dashboard = page.locator("#workspace-switcher");
  const form = page.locator("input[name=email]");
  await expect(dashboard.or(form)).toBeVisible();
  // A saved sign-in may have ended (password change, data import).
  if (await form.isVisible()) {
    await form.fill(account.email);
    await page.locator("input[name=password]").fill(password);
    await page.getByRole("button", { name: /Se connecter/ }).click();
    await expect(dashboard).toBeVisible();
    signedIn.set(account.email, await page.context().storageState());
  }
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
