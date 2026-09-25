import { expect, test } from "@playwright/test";
import { admin, password, signIn } from "./helpers";

// Runs last: the import signs everyone out.
test("an administrator keeps restore points and moves all data with an encrypted file", async ({
  browser,
}) => {
  const page = await signIn(browser, admin);
  await page.goto("/account/data");
  const data = page.locator(".account-page .admin-data");
  await expect(data).toContainText("Sauvegardes automatiques");

  await data.getByPlaceholder("Ex. Avant la recette").fill("Recette E2E");
  await data.getByRole("button", { name: "Créer maintenant" }).click();
  const point = data.locator(".admin-data-list > li", {
    hasText: "Recette E2E",
  });
  await expect(point).toContainText("Point de restauration");
  await point.getByRole("button", { name: /Récupérer une séance/ }).click();
  await expect(point.locator(".admin-data-panel")).toContainText("Atelier E2E");

  await data.getByRole("button", { name: /^Exporter…/ }).click();
  const exportForm = data.locator(".admin-data-panel");
  await exportForm.getByLabel("Votre mot de passe").fill(password);
  await exportForm
    .getByLabel("Phrase de chiffrement", { exact: true })
    .fill("phrase de test assez longue");
  await exportForm
    .getByLabel("Répétez la phrase")
    .fill("phrase de test assez longue");
  const downloading = page.waitForEvent("download");
  await exportForm.getByRole("button", { name: "Exporter chiffré" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^meetloom-.*\.mldx$/);
  const file = await download.path();

  await data.getByRole("button", { name: /^Importer…/ }).click();
  const importForm = data.locator(".admin-data-panel.warning");
  await importForm.locator("input[type=file]").setInputFiles(file);
  await importForm
    .getByLabel("Phrase de chiffrement")
    .fill("phrase de test assez longue");
  await importForm.getByLabel("Votre mot de passe").fill(password);
  const replace = importForm.getByRole("button", {
    name: "Importer et remplacer",
  });
  await expect(replace).toBeDisabled();
  await importForm.getByLabel(/Tapez REMPLACER/).fill("remplacer");
  await replace.click();
  await expect(data).toContainText("Tout le monde a été déconnecté");
  await data.getByRole("button", { name: "Se reconnecter" }).click();
  // Back on the sign-in page, the same accounts and sessions are there.
  await expect(page.locator("input[name=email]")).toBeVisible({
    timeout: 10_000,
  });
  await page.locator("input[name=email]").fill(admin.email);
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: /Se connecter/ }).click();
  await expect(page.locator("#workspace-switcher")).toBeVisible();
});
