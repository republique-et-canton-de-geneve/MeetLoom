import { expect, test } from "@playwright/test";
import { admin, addActivities, createSession, password } from "./helpers";

test("the alternate proxy URL keeps assets, navigation, editing and visitor links under its prefix", async ({
  page,
  browser,
  baseURL,
}) => {
  const publicBase = `http://localhost:${new URL(baseURL!).port}/meetloom`;
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("requestfailed", (request) => {
    if (!request.failure()?.errorText.includes("ERR_ABORTED"))
      failures.push(request.url());
  });
  await page.goto(publicBase);
  await page
    .getByRole("button", { name: "Séance rapide", exact: true })
    .click();
  const worker = page.waitForEvent("worker");
  const stamp = (time: number) =>
    new Date(time)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const now = Date.now();
  await page
    .getByLabel("Invitation Outlook ou calendrier", { exact: true })
    .setInputFiles({
      name: "prefix.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(
        [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "BEGIN:VEVENT",
          "UID:prefix@example.test",
          `DTSTAMP:${stamp(now)}`,
          `DTSTART:${stamp(now - 60_000)}`,
          `DTEND:${stamp(now + 30 * 60_000)}`,
          "SUMMARY:Décompte URL publique",
          "END:VEVENT",
          "END:VCALENDAR",
          "",
        ].join("\r\n"),
      ),
    });
  expect((await worker).url()).toContain(
    "/meetloom/assets/meeting-invitation.worker-",
  );
  await expect(
    page
      .locator(".quick-meeting")
      .getByRole("heading", { name: "Décompte URL publique" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fermer la séance rapide" }).click();
  await page.locator("input[name=email]").fill(admin.email);
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: /Se connecter/ }).click();
  await expect(page.locator("#workspace-switcher")).toBeVisible();
  await createSession(page, "Séance URL publique");
  await addActivities(page, ["Bloc URL publique"]);
  expect(page.url()).toMatch(/\/meetloom\/session\//);
  await page.reload();
  await expect(page.locator(".display-time-control")).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop();
  const share = await page.request.post(
    `${publicBase}/api/sessions/${id}/shares`,
    {
      headers: { Origin: new URL(publicBase).origin },
      data: { label: "Proxy", mode: "agenda" },
    },
  );
  expect(share.status()).toBe(201);
  const {
    share: { token },
  } = await share.json();
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  await page
    .locator(".list-item", { hasText: "Proxy" })
    .getByRole("button", { name: "Afficher le lien" })
    .click();
  await expect(page.getByLabel("Lien visiteur créé")).toHaveValue(
    `${publicBase}/s/${token}`,
  );
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${publicBase}/s/${token}`);
  await expect(visitor.getByText("Séance URL publique").first()).toBeVisible();
  await expect(visitor.getByText("Bloc URL publique").first()).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByText("Séance URL publique").first()).toBeVisible();
  const native = await (await browser.newContext()).newPage();
  await native.goto(`${baseURL}/s/${token}`);
  await expect(native.getByText("Séance URL publique").first()).toBeVisible();
  expect(failures).toEqual([]);
});
