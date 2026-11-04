import { expect, test, type Locator, type Page } from "@playwright/test";
import { admin, createSession, password, signIn } from "./helpers";

const invitationLabel = "Invitation Outlook ou calendrier";
const meetingTitle = "Point de coordination E2E";
const meetingBody = "Welcome 5 min, Discussion 40 min";

function invitation(now = Date.now()) {
  const stamp = (time: number) =>
    new Date(time)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MeetLoom//Nominal E2E//EN",
    "BEGIN:VEVENT",
    "UID:quick-meeting-e2e@example.test",
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(now - 10 * 60_000)}`,
    `DTEND:${stamp(now + 35 * 60_000)}`,
    `SUMMARY:${meetingTitle}`,
    `DESCRIPTION:${meetingBody.replaceAll(",", "\\,")}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function networkRequests(page: Page) {
  const requests = { unexpected: [] as string[], ai: [] as string[] };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return;
    if (/\/ai(?:\/|$)/.test(path))
      requests.ai.push(`${request.method()} ${path}`);
    if (
      (/^\/api\/sessions(?:\/|$)/.test(path) &&
        !["GET", "HEAD"].includes(request.method())) ||
      /^\/api\/import(?:\/|$)/.test(path)
    )
      requests.unexpected.push(`${request.method()} ${path}`);
  });
  return requests;
}

async function sessions(page: Page) {
  const response = await page.request.get("/api/sessions");
  expect(response.ok()).toBe(true);
  return response.json();
}

async function remaining(clock: Locator) {
  return (await clock.innerText())
    .split(":")
    .reduce((seconds, part) => seconds * 60 + Number(part), 0);
}

async function pickCalendar(page: Page, label: string, contents: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByLabel(label, { exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "invitation.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from(contents),
  });
}

test("dropping a calendar starts a local countdown and applies an AI agenda only on request", async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  try {
    // Keep real authentication, changing only the optional capability flag.
    await page.route("**/api/auth/status", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), aiEnabled: true },
      });
    });
    const aiBodies: { prompt: string; duration: number; locale: string }[] = [];
    await page.route("**/api/ai/generate", async (route) => {
      aiBodies.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          blocks: [
            { id: "quick-ai-welcome", title: "Welcome", duration: 5 },
            { id: "quick-ai-discussion", title: "Discussion", duration: 40 },
          ].map((block) => ({
            ...block,
            kind: "activity",
            description: "",
            category: "discussion",
            facilitator: "",
            section: "",
            fields: {},
          })),
        },
      });
    });
    // Mock the browser's always-on-top capability. The parser, calendar
    // worker, domain timer, React portal, and pause/resume remain real.
    await page.addInitScript(() => {
      const state = window as typeof window & {
        __quickMeetingPipCalls: number;
      };
      state.__quickMeetingPipCalls = 0;
      Object.defineProperty(window, "documentPictureInPicture", {
        configurable: true,
        value: {
          requestWindow: async () => {
            state.__quickMeetingPipCalls++;
            const frame = document.createElement("iframe");
            frame.id = "quick-meeting-pip-fixture";
            frame.title = "Simulated always-on-top window";
            frame.width = "560";
            frame.height = "188";
            document.body.appendChild(frame);
            const floating = frame.contentWindow!;
            let closed = false;
            Object.defineProperty(floating, "closed", { get: () => closed });
            floating.close = () => {
              if (closed) return;
              closed = true;
              floating.dispatchEvent(new Event("pagehide"));
              frame.remove();
            };
            return floating;
          },
        },
      });
    });
    await page.goto("/");
    await page.locator("input[name=email]").fill(admin.email);
    await page.locator("input[name=password]").fill(password);
    await page.getByRole("button", { name: /Se connecter/ }).click();
    await expect(page.locator("#workspace-switcher")).toBeVisible();
    const before = await sessions(page);
    const requests = networkRequests(page);
    await page.evaluate((calendar) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([calendar], "invitation.ics", { type: "text/calendar" }),
      );
      document.body.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }, invitation());

    const quick = page.locator(".quick-meeting");
    const timer = quick.locator(".timer-content");
    const clock = timer.locator(".timer-clock strong");
    await expect(
      quick.getByRole("heading", { name: meetingTitle }),
    ).toBeVisible();
    await expect(timer).toContainText("EN CE MOMENT");
    await expect(timer.locator(".timer-position")).toContainText("1 / 1");
    // Ten minutes of the 45-minute invitation have already elapsed.
    expect(await remaining(clock)).toBeGreaterThan(34 * 60);
    expect(await remaining(clock)).toBeLessThanOrEqual(35 * 60);
    const progress = await timer
      .locator(".timer-track > span")
      .evaluate((node) => parseFloat((node as HTMLElement).style.width));
    expect(progress).toBeGreaterThanOrEqual(22);
    expect(progress).toBeLessThan(24);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __quickMeetingPipCalls: number })
            .__quickMeetingPipCalls,
      ),
    ).toBe(1);
    const floating = page
      .frameLocator("#quick-meeting-pip-fixture")
      .locator(".timer-content");
    await expect(floating).toContainText(meetingTitle);
    await expect(floating).toContainText("EN CE MOMENT");
    expect(await sessions(page)).toEqual(before);
    expect(requests.ai).toEqual([]);
    expect(aiBodies).toEqual([]);

    await quick.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(timer).toContainText("EN PAUSE");
    await expect(floating).toContainText("EN PAUSE");
    const paused = await clock.innerText();
    await page.waitForTimeout(1100); // Exercise a real timer tick while paused.
    await expect(clock).toHaveText(paused);
    await expect(floating.locator(".timer-clock strong")).toHaveText(paused);
    await quick.getByRole("button", { name: "Reprendre", exact: true }).click();
    await expect(timer).toContainText("EN CE MOMENT");
    await expect
      .poll(() => remaining(clock))
      .toBeLessThan(await remaining(clock));

    const beforeAnalysis = await remaining(clock);
    await quick
      .getByRole("button", { name: "Analyser le déroulé de l’invitation" })
      .click();
    const proposal = quick.locator(".quick-meeting-proposal");
    await expect(proposal).toBeVisible();
    await expect(proposal.getByRole("listitem")).toHaveText([
      "Welcome 5 min",
      "Discussion 40 min",
    ]);
    expect(requests.ai).toEqual(["POST /api/ai/generate"]);
    expect(aiBodies).toHaveLength(1);
    expect(aiBodies[0].prompt).toContain(meetingTitle);
    expect(aiBodies[0].prompt).toContain(meetingBody);
    expect(aiBodies[0]).toMatchObject({ duration: 45, locale: "fr" });
    // A proposal must not replace the live agenda until explicitly applied.
    await expect(timer.locator(".timer-position")).toContainText("1 / 1");
    await expect(timer).toContainText(meetingTitle);
    expect(await remaining(clock)).toBeLessThanOrEqual(beforeAnalysis);
    expect(await remaining(clock)).toBeGreaterThan(34 * 60);
    await proposal
      .getByRole("button", { name: "Appliquer le déroulé" })
      .click();
    await expect(proposal).toHaveCount(0);
    await expect(timer.locator(".timer-position")).toContainText("2 / 2");
    await expect(timer).toContainText("Discussion");
    await expect(floating).toContainText("Discussion");
    // Catch up from the original start: five minutes of Discussion elapsed,
    // rather than restarting its full 40 minutes when the proposal is applied.
    expect(await remaining(clock)).toBeGreaterThan(34 * 60);
    expect(await remaining(clock)).toBeLessThanOrEqual(35 * 60);

    await quick
      .getByRole("button", { name: "Fermer la séance rapide" })
      .click();
    await expect(quick).toHaveCount(0);
    await expect(page.locator("#quick-meeting-pip-fixture")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("#workspace-switcher")).toBeVisible();
    await expect(page.locator(".quick-meeting")).toHaveCount(0);
    expect(await sessions(page)).toEqual(before);
    expect(requests.unexpected).toEqual([]);
    expect(requests.ai).toEqual(["POST /api/ai/generate"]);
  } finally {
    await page.context().close();
  }
});

test("the file picker rejects an invalid calendar and works in English when floating windows are unavailable", async ({
  browser,
}) => {
  const page = await signIn(browser, admin);
  try {
    await page.addInitScript(() => {
      Object.defineProperty(window, "documentPictureInPicture", {
        configurable: true,
        value: {
          requestWindow: async () => {
            throw new DOMException(
              "Simulated browser refusal",
              "NotAllowedError",
            );
          },
        },
      });
    });
    await page.reload();
    await expect(page.locator("#workspace-switcher")).toBeVisible();
    const before = await sessions(page);
    const requests = networkRequests(page);
    await page
      .getByRole("button", { name: "Séance rapide", exact: true })
      .click();
    await expect(
      page.getByLabel(invitationLabel, { exact: true }),
    ).toBeAttached();
    await pickCalendar(
      page,
      invitationLabel,
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
    );
    const quick = page.locator(".quick-meeting");
    await expect(quick.getByRole("alert")).toContainText(
      "Invitation illisible",
    );
    await expect(quick.locator(".timer-content")).toHaveCount(0);
    expect(await sessions(page)).toEqual(before);

    await page.getByRole("button", { name: "Switch to English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByLabel("Outlook or calendar invitation", { exact: true }),
    ).toBeAttached();
    await pickCalendar(page, "Outlook or calendar invitation", invitation());
    await expect(
      quick.getByRole("heading", { name: meetingTitle }),
    ).toBeVisible();
    await expect(quick.getByRole("alert")).toHaveCount(0);
    await expect(quick.locator(".timer-content")).toContainText("RIGHT NOW");
    expect(
      await remaining(quick.locator(".timer-clock strong")),
    ).toBeLessThanOrEqual(35 * 60);
    await expect(
      quick.getByRole("button", { name: "Show always on top" }),
    ).toBeVisible();
    await expect(quick.getByRole("status")).toContainText(
      "The browser requires a click to open the window",
    );
    await quick.getByRole("button", { name: "Show always on top" }).click();
    await expect(quick.getByRole("status")).toContainText(
      "Use the ‘Show always on top’ button",
    );
    await expect(quick.locator(".timer-content")).toContainText("RIGHT NOW");
    await page.reload();
    await expect(page.locator("#workspace-switcher")).toBeVisible();
    await expect(page.locator(".quick-meeting")).toHaveCount(0);
    expect(await sessions(page)).toEqual(before);
    expect(requests).toEqual({ unexpected: [], ai: [] });
  } finally {
    await page.context().close();
  }
});

test("a guest starts a temporary countdown without an account, including before installation setup", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  const requests: string[] = [];
  let needsSetup = false;
  try {
    // Exercise both installation states without creating an account or
    // changing server data; a configured AI provider grants no guest access.
    await page.route("**/api/auth/status", async (route) => {
      const response = await route.fetch();
      const status = await response.json();
      expect(status.user).toBeNull();
      await route.fulfill({
        response,
        json: { ...status, needsSetup, aiEnabled: true },
      });
    });
    await page.addInitScript(() => {
      Object.defineProperty(window, "documentPictureInPicture", {
        configurable: true,
        value: {
          requestWindow: async () => {
            throw new DOMException(
              "Simulated browser refusal",
              "NotAllowedError",
            );
          },
        },
      });
    });
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/"))
        requests.push(`${request.method()} ${path}`);
    });
    for (const setup of [false, true]) {
      needsSetup = setup;
      await page.goto("/");
      await expect(page.locator("input[name=email]")).toBeVisible();
      await expect(page.locator("input[name=name]")).toHaveCount(setup ? 1 : 0);
      await expect(
        page.getByRole("button", { name: "Séance rapide", exact: true }),
      ).toBeVisible();
      const assertNoBrandOverlap = async (launcher: Locator) => {
        await expect(launcher).toBeVisible();
        const brand = await page.locator(".auth-story .brand").boundingBox();
        const button = await launcher.boundingBox();
        expect(brand).not.toBeNull();
        expect(button).not.toBeNull();
        const overlapping =
          Math.min(brand!.x + brand!.width, button!.x + button!.width) >
            Math.max(brand!.x, button!.x) &&
          Math.min(brand!.y + brand!.height, button!.y + button!.height) >
            Math.max(brand!.y, button!.y);
        expect(
          overlapping,
          "The quick meeting launcher must not overlap the logo at 390px",
        ).toBe(false);
      };
      await assertNoBrandOverlap(
        page.getByRole("button", { name: "Séance rapide", exact: true }),
      );
      await page.getByRole("button", { name: "Switch to English" }).click();
      await assertNoBrandOverlap(
        page.getByRole("button", { name: "Quick meeting", exact: true }),
      );
      await page.getByRole("button", { name: "Passer en français" }).click();
      const calendar = invitation();
      const end = calendar.match(/DTEND:\d{8}T(\d{2})(\d{2})\d{2}Z/)!;
      const expectedEnd = `${end[1]}:${end[2]}`;
      await page.evaluate((calendar) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([calendar], "invitation.ics", { type: "text/calendar" }),
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
        quick.getByRole("heading", { name: meetingTitle }),
      ).toBeVisible();
      await expect(quick.locator(".timer-content")).toContainText(
        "EN CE MOMENT",
      );
      await expect(quick.locator(".timer-position")).toContainText("1 / 1");
      await expect(quick.locator(".timer-end")).toHaveText(
        `Fin prévue ${expectedEnd}`,
      );
      await expect(
        quick.getByRole("button", {
          name: "Analyser le déroulé de l’invitation",
        }),
      ).toBeDisabled();
      await expect(quick).toContainText(
        "Connectez-vous pour analyser le déroulé avec l’IA.",
      );
      const clock = quick.locator(".timer-clock strong");
      expect(await remaining(clock)).toBeGreaterThan(34 * 60);
      expect(await remaining(clock)).toBeLessThanOrEqual(35 * 60);
      await expect(quick.getByRole("status")).toContainText(
        "Le navigateur demande un clic",
      );
      await page.reload();
      await expect(page.locator("input[name=email]")).toBeVisible();
      await expect(page.locator(".quick-meeting")).toHaveCount(0);
    }
    expect(await context.cookies()).toEqual([]);
    // Existing public homepage status and announcements are the only API
    // requests: the invitation, parsing and countdown stay in this browser.
    expect(requests.length).toBeGreaterThan(0);
    expect(
      requests.filter(
        (request) =>
          !["GET /api/auth/status", "GET /api/announcement"].includes(request),
      ),
    ).toEqual([]);
  } finally {
    await context.close();
  }
});

test("calendar drop handling preserves the agenda import file input and picker", async ({
  browser,
}) => {
  const page = await signIn(browser, admin);
  try {
    await createSession(page, "Import sans interception E2E");
    await page.getByRole("button", { name: "Autres actions" }).click();
    await page
      .getByRole("button", { name: "Importer un agenda", exact: true })
      .click();
    const panel = page.locator(".document-import");
    const input = panel.locator('input[type="file"]');
    await expect(input).toBeVisible();
    const events = await input.evaluate((input) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["Sujet importé E2E"], "agenda.txt", { type: "text/plain" }),
      );
      return [
        input,
        input.closest(".file-drop")!.querySelector("span")!,
      ].flatMap((target) =>
        ["dragenter", "dragover", "drop"].map((type) => {
          const event = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          });
          target.dispatchEvent(event);
          return { type, canceled: event.defaultPrevented };
        }),
      );
    });
    expect(events).toEqual([
      { type: "dragenter", canceled: false },
      { type: "dragover", canceled: false },
      { type: "drop", canceled: false },
      { type: "dragenter", canceled: false },
      { type: "dragover", canceled: false },
      { type: "drop", canceled: false },
    ]);
    await page.evaluate((calendar) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([calendar], "handled.ics", { type: "text/calendar" }),
      );
      const event = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      });
      // A local drop handler has already claimed the event before bubbling.
      event.preventDefault();
      document.body.dispatchEvent(event);
    }, invitation());
    await expect(page.locator(".quick-meeting")).toHaveCount(0);
    await expect(page.locator(".quick-meeting-drag")).toHaveCount(0);
    // Synthetic events cannot prove the browser's native file-drop behavior.
    // Exercise the real picker and import path separately with the same file.
    const chooser = page.waitForEvent("filechooser");
    await input.click();
    await (
      await chooser
    ).setFiles({
      name: "agenda.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Sujet importé E2E"),
    });
    await expect(
      panel.getByLabel("Texte à convertir (modifiable)"),
    ).toHaveValue("Sujet importé E2E");
    await panel.getByRole("button", { name: "Un bloc par ligne" }).click();
    await expect(panel.locator(".import-block input").first()).toHaveValue(
      "Sujet importé E2E",
    );
    await panel.getByRole("button", { name: "Ajouter à la séance" }).click();
    await expect(panel).toHaveCount(0);
    await expect(
      page.getByRole("textbox", {
        name: "Durée de Sujet importé E2E",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".quick-meeting")).toHaveCount(0);
  } finally {
    await page.context().close();
  }
});
