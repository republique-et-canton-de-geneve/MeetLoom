import { expect, test } from "@playwright/test";
import { addActivities, admin, createSession, signIn } from "./helpers";

test("closing a quick countdown keeps the saved session's separate popup open", async ({
  browser,
}) => {
  const page = await signIn(browser, admin);
  const savedTitle = "Saved popup activity";
  const quickTitle = "Temporary popup activity";
  try {
    // Exercise real named browser windows rather than a simulated PiP.
    await page.evaluate(() =>
      Object.defineProperty(window, "documentPictureInPicture", {
        value: undefined,
        configurable: true,
      }),
    );
    await createSession(page, "Independent floating countdowns");
    await addActivities(page, [savedTitle]);
    await page.getByRole("button", { name: /Animer la séance/ }).click();
    const [savedWindow] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByTitle("Fenêtre au premier plan").click(),
    ]);
    await expect(savedWindow.locator(".timer-content")).toContainText(
      savedTitle,
    );

    const now = Date.now();
    const stamp = (time: number) =>
      new Date(time)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    const calendar = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MeetLoom//Popup isolation E2E//EN",
      "BEGIN:VEVENT",
      "UID:independent-popup@example.test",
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(now - 60_000)}`,
      `DTEND:${stamp(now + 9 * 60_000)}`,
      `SUMMARY:${quickTitle}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    // The editor accepts a global calendar drop without a dashboard launcher.
    // Real popup windows remain enabled by Playwright's Chromium launcher.
    await page.evaluate((contents) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([contents], "independent-popup.ics", {
          type: "text/calendar",
        }),
      );
      document.body.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }, calendar);
    const quick = page.locator(".quick-meeting");
    await expect(
      quick.getByRole("heading", { name: quickTitle }),
    ).toBeVisible();

    // Reusing the saved popup's name would mount two timers in one window.
    await expect.poll(() => page.context().pages().length).toBe(3);
    const quickWindow = page
      .context()
      .pages()
      .find((candidate) => candidate !== page && candidate !== savedWindow)!;
    await expect(quickWindow.locator(".timer-content")).toHaveCount(1);
    await expect(quickWindow.locator(".timer-content")).toContainText(
      quickTitle,
    );
    await expect(savedWindow.locator(".timer-content")).toHaveCount(1);
    await expect(savedWindow.locator(".timer-content")).toContainText(
      savedTitle,
    );
    await expect(savedWindow.locator(".timer-content")).not.toContainText(
      quickTitle,
    );

    await quick
      .getByRole("button", { name: "Fermer la séance rapide" })
      .click();
    await expect.poll(() => quickWindow.isClosed()).toBe(true);
    expect(savedWindow.isClosed()).toBe(false);
    await expect(savedWindow.locator(".timer-clock strong")).toHaveCount(1);
    await expect(savedWindow.locator(".timer-content")).toContainText(
      savedTitle,
    );
    // The saved popup still controls its own persisted session.
    await savedWindow
      .getByRole("button", { name: "Pause", exact: true })
      .click();
    await expect(savedWindow.locator(".timer-content")).toContainText(
      "EN PAUSE",
    );
    await expect(page.locator(".timer-bar")).toContainText("EN PAUSE");
  } finally {
    await page.context().close();
  }
});
