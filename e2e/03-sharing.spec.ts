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

test("participants and organizers talk in one conversation, answers marked as the team's", async ({
  browser,
}) => {
  const page = await signIn(browser, member);
  await page.getByText("Atelier E2E").first().click();
  await expect(page.locator(".display-time-control")).toBeVisible();
  const sessionId = page.url().split("/").pop();
  const created = await page.request.post(`/api/sessions/${sessionId}/shares`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { label: "Salle E2E", mode: "visitor", allowComments: true },
  });
  const { share } = await created.json();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/s/${share.token}`);
  const discussion = visitor.locator(".visitor-discussion");
  await discussion.getByLabel("Votre nom").fill("Toto");
  await discussion
    .getByLabel("Votre question ou commentaire")
    .fill("À quelle heure est la pause ?");
  await discussion.getByLabel("Votre question ou commentaire").press("Enter");
  await expect(discussion).toContainText("À quelle heure est la pause ?");
  // The name is remembered: no form to fill again.
  await expect(discussion).toContainText("Vous écrivez en tant que Toto");

  // The organizers answer right under the question.
  await page.getByTitle("Discussion", { exact: true }).click();
  const panel = page.locator(".discussion");
  const thread = panel.locator(".chat-thread", {
    hasText: "À quelle heure est la pause ?",
  });
  await expect(thread).toContainText("Salle E2E");
  await thread.getByRole("button", { name: "Répondre" }).click();
  await thread.getByLabel("Votre réponse").fill("À 10 h 30.");
  await thread.getByLabel("Votre réponse").press("Enter");
  await expect(thread).toContainText("À 10 h 30.");
  await thread.getByRole("button", { name: "Marquer comme résolu" }).click();
  await expect(thread).toContainText("Résolu");

  // The visitor sees the answer as the team's, and the resolved exchange
  // stays visible, folded.
  const answered = discussion.locator(".chat-thread", {
    hasText: "À quelle heure est la pause ?",
  });
  await expect(answered).toContainText("Résolu", { timeout: 15_000 });
  const answer = answered.locator(".chat-message.is-team", {
    hasText: "À 10 h 30.",
  });
  // Open on screen, it stays open; on the next visit it is folded.
  await expect(answer).toContainText("Équipe");
  await visitor.reload();
  await expect(answer).toHaveCount(0);
  await answered.locator(".chat-folded").click();
  await expect(answer).toContainText("Équipe");
});
