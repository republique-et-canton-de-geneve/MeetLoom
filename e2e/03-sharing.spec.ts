import { expect, test } from "@playwright/test";
import { member, signIn } from "./helpers";

test("a visitor link shows the agenda but never the team's private notes", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await page.getByText("Atelier E2E").first().click();
  await expect(page.locator(".display-time-control")).toBeVisible();
  const secret = "NOTE-PRIVEE-E2E-7431";
  const notes = page.getByLabel("Notes de présentation · Accueil").last();
  await notes.click();
  await page.keyboard.type(secret);
  await page.locator(".agenda-summary").click();
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
  // The note really is stored for the team before checking the visitor side.
  await page.reload();
  await expect(page.getByText(secret).first()).toBeVisible();
  const sessionId = page.url().split("/").pop();
  const created = await page.request.post(`/api/sessions/${sessionId}/shares`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { label: "E2E", mode: "agenda" },
  });
  expect(created.status()).toBe(201);
  const { share } = await created.json();

  const visitor = await (await browser.newContext()).newPage();
  const responses: string[] = [];
  visitor.on("response", async (response) => {
    if (response.url().includes("/api/public/"))
      responses.push(await response.text().catch(() => ""));
  });
  await visitor.goto(`/s/${share.token}`);
  await expect(visitor.getByText("Accueil").first()).toBeVisible();
  await expect(visitor.getByText("Décision").first()).toBeVisible();
  await expect(visitor.getByText(secret)).toHaveCount(0);
  expect(responses.length).toBeGreaterThan(0);
  expect(responses.join("\n")).not.toContain(secret);

  // The owner finds the address again after closing the share dialog.
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const link = page.locator(".list-item", { hasText: "E2E" });
  await link.getByRole("button", { name: "Afficher le lien" }).click();
  await expect(page.getByLabel("Lien visiteur créé")).toHaveValue(
    new RegExp(`/s/${share.token}$`),
  );
});
