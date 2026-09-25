import { expect, test } from "@playwright/test";
import { admin, createSession, member, password, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("the first visitor sets up the installation as its administrator", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Créons votre espace.")).toBeVisible();
  await page.locator("input[name=name]").fill(admin.name);
  await page.locator("input[name=email]").fill(admin.email);
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(
    page.getByRole("heading", { name: /Bonjour Alex/ }),
  ).toBeVisible();
  await createSession(page, "Séance de l’admin");
});

test("anyone else creates their own account and only sees their own sessions", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer un compte" }).click();
  await page.locator("input[name=name]").fill(member.name);
  await page.locator("input[name=email]").fill(member.email);
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(
    page.getByRole("heading", { name: /Bonjour Camille/ }),
  ).toBeVisible();
  await expect(page.getByText("Séance de l’admin")).toHaveCount(0);
  await createSession(page, "Séance de Camille");
});

test("accounts sign in again and keep their sessions apart", async ({
  browser,
}) => {
  const alex = await signIn(browser, admin, { fresh: true });
  await expect(alex.getByText("Séance de l’admin")).toBeVisible();
  await expect(alex.getByText("Séance de Camille")).toHaveCount(0);
  const camille = await signIn(browser, member, { fresh: true });
  await expect(camille.getByText("Séance de Camille")).toBeVisible();
  await expect(camille.getByText("Séance de l’admin")).toHaveCount(0);
});

test("a wrong password is refused and the interface switches to English", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[name=email]").fill(member.email);
  await page.locator("input[name=password]").fill("not-the-right-password");
  await page.getByRole("button", { name: /Se connecter/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("button", { name: /Sign in/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
