import { expect, test, type Locator } from "@playwright/test";
import { admin, member, signIn } from "./helpers";

test("before an update the administrator sees the version and the sessions being run", async ({
  browser,
}) => {
  const facilitator = await signIn(browser, member);
  await facilitator.getByText("Atelier E2E").first().click();
  await facilitator.getByRole("button", { name: /Animer la séance/ }).click();
  await expect(facilitator.locator(".timer-bar")).toContainText("Accueil");

  const page = await signIn(browser, admin);
  // The account and administration live on their own page.
  await page.getByRole("button", { name: /Mon compte & équipe/ }).click();
  await expect(page).toHaveURL(/\/account$/);
  const account = page.locator(".account-page");
  await account.getByRole("link", { name: "Activité en cours" }).click();
  await expect(page).toHaveURL(/\/account\/activity$/);
  const activity = account.locator(".admin-activity");
  await expect(activity).toContainText("Version installée");
  const row = activity.locator("li", { hasText: "Atelier E2E" });
  await expect(row).toContainText("Animée en ce moment");
  await expect(row).toContainText("Accueil");
  await expect(row).toContainText(member.name);
  // Everyone signed in can read the version.
  await expect(account.locator(".app-version")).toContainText(/MeetLoom \d/);

  await facilitator.getByTitle("Réinitialiser").click();
  await expect(
    facilitator.getByRole("button", { name: /Animer la séance/ }),
  ).toBeVisible();
  await activity.getByRole("button", { name: "Actualiser" }).click();
  await expect(activity).not.toContainText("Animée en ce moment");
});

test("an announcement reaches everyone, and a reported problem reaches the administrators with its logs", async ({
  browser,
}) => {
  const page = await signIn(browser, admin);
  await page.goto("/account/settings");
  const announcement = page.locator(".admin-announcement");
  await announcement
    .getByLabel("Message", { exact: true })
    .fill("Maintenance ce soir à 18 h.");
  await announcement.getByLabel("Type").selectOption("warning");
  await announcement.getByRole("button", { name: "Publier" }).click();
  await expect(announcement).toContainText("Message publié.");

  const colleague = await signIn(browser, member);
  const banner = colleague.locator(".announcement-banner");
  await expect(banner).toContainText("Maintenance ce soir à 18 h.");
  await colleague.getByRole("button", { name: "Signaler un problème" }).click();
  await expect(colleague).toHaveURL(/\/account\/feedback$/);
  // Each kind is a card named by its own label; clicking it selects it.
  const idea = colleague.getByRole("radio", {
    name: /Une idée ou une demande/,
  });
  await colleague.getByText("Une idée ou une demande").click();
  await expect(idea).toBeChecked();
  await expect(colleague.getByLabel("Votre message")).toBeVisible();
  await colleague.getByText("Un problème", { exact: true }).click();
  await expect(
    colleague.getByRole("radio", { name: /Un problème/ }),
  ).toBeChecked();
  await colleague
    .getByLabel("Que s’est-il passé ? Qu’attendiez-vous ?")
    .fill("Le bouton Exporter ne répond pas.");
  await colleague.getByRole("button", { name: "Envoyer" }).click();
  await expect(colleague.getByRole("status")).toContainText("Merci !");
  await expect(colleague.locator(".feedback-list")).toContainText("Reçu");
  // The banner stays as long as the administrators keep it.
  await expect(banner.getByRole("button")).toHaveCount(0);

  await page.goto("/account/feedback-inbox");
  const report = page.locator(".admin-feedback li", {
    hasText: "Le bouton Exporter ne répond pas.",
  });
  await expect(report).toContainText(member.name);
  await expect(
    report.getByRole("link", { name: "Créer une issue GitHub" }),
  ).toHaveAttribute("href", /github\.com\/.*\/issues\/new\?title=/);
  await report.getByLabel("Statut").selectOption("done");

  await page.goto("/account/logs");
  const logs = page.locator(".admin-logs");
  await logs.getByLabel("Niveau").selectOption("info");
  await expect(logs.locator(".admin-logs-list")).toContainText(
    "MeetLoom listening",
  );

  await page.goto("/account/settings");
  await announcement
    .getByRole("button", { name: "Retirer le message" })
    .click();
  await expect(announcement).toContainText("Message retiré.");
});

test("a workspace administrator reads each member in full, on a computer and on a phone", async ({
  browser,
}) => {
  const page = await signIn(browser, admin);
  await page.getByRole("button", { name: "Créer un espace" }).click();
  await page.getByLabel("Nom de l’espace").fill("Équipe admin E2E");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  const panel = page.locator("dialog.modal", { hasText: "Gérer l’espace" });
  await panel.getByRole("button", { name: "Membres et invités" }).click();
  const row = panel.locator(".workspace-member", { hasText: admin.email });
  await expect(row).toBeVisible();
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  const name = row.getByText(admin.name, { exact: true });
  // One line, not one letter per line beside a role selector filling the row.
  expect((await box(name)).height).toBeLessThan(30);
  // The add button lines up with its fields.
  const field = await box(panel.getByLabel("Adresse e-mail"));
  const add = await box(
    panel.getByRole("button", { name: "Ajouter / inviter" }),
  );
  expect(Math.abs(field.y + field.height - (add.y + add.height))).toBeLessThan(
    3,
  );
  // On a phone the role and the remove button share the line under the name.
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await box(name)).height).toBeLessThan(30);
  const role = await box(
    row.getByRole("combobox", { name: `Rôle de ${admin.name}` }),
  );
  const remove = await box(
    row.getByRole("button", { name: `Retirer l’accès de ${admin.name}` }),
  );
  expect(Math.abs(role.y - remove.y)).toBeLessThan(5);
});
