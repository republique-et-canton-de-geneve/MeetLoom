import { expect, test } from "@playwright/test";
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
  await colleague
    .getByLabel("Que s’est-il passé ? Qu’attendiez-vous ?")
    .fill("Le bouton Exporter ne répond pas.");
  await colleague.getByRole("button", { name: "Envoyer" }).click();
  await expect(colleague.getByRole("status")).toContainText("Merci !");
  await expect(colleague.locator(".feedback-list")).toContainText("Reçu");
  // Closing the banner hides this message in this browser.
  await banner.getByRole("button", { name: "Masquer ce message" }).click();
  await expect(banner).toHaveCount(0);

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
