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
  await page.getByRole("button", { name: /Mon compte & équipe/ }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("summary", { hasText: "Activité en cours" }).click();
  const activity = dialog.locator(".admin-activity");
  await expect(activity).toContainText("Version installée");
  const row = activity.locator("li", { hasText: "Atelier E2E" });
  await expect(row).toContainText("Animée en ce moment");
  await expect(row).toContainText("Accueil");
  await expect(row).toContainText(member.name);
  // Everyone signed in can read the version.
  await expect(dialog.locator(".app-version")).toContainText(/MeetLoom \d/);

  await facilitator.getByTitle("Réinitialiser").click();
  await expect(
    facilitator.getByRole("button", { name: /Animer la séance/ }),
  ).toBeVisible();
  await activity.getByRole("button", { name: "Actualiser" }).click();
  await expect(activity).not.toContainText("Animée en ce moment");
});
