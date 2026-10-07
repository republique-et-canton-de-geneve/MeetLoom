# Changelog

User-visible changes, newest first. Internal changes (refactors, tests, CI, dependency updates) are not listed; see the Git history. Format: [Keep a Changelog](https://keepachangelog.com/), versions follow `package.json`.

## [Unreleased]

### Added

- Sections can be inserted from the agenda like blocks, groups and notes: they gather the blocks that follow, show their times and duration, and can be renamed, collapsed or removed in place. Adding or moving blocks (including with the arrows) keeps sections whole, and a section containing a group is no longer announced twice in the visitor agenda, print and CSV.
- The dashboard flags sessions that are over but not closed yet ("Séance terminée · Clôturer ?" / "Session over · Close it?"), once their timer finishes or the date set in the agenda has passed, with a count banner and a new "To close" activity filter, so they can be closed in two clicks and counted in the session report.

### Changed

- After the timer passes a block, its time cell shows the actual time, a coloured gap (= on schedule, blue early, amber late, red from five minutes late) and the time planned when the timer started, so overruns stay visible even after +1/+5 or "Use actual durations". Group and section headers, the day duration, the end of the agenda and the sidebar total read "Planned X · actual Y" with the gap once all their steps have been played. Past runs count the same whole seconds and minutes, including a step left after less than a second, so they show the same gap as the agenda, "very late" in red included.
- The agenda minimap shows the activities inside groups and parallel rooms in their own colours. During a run, finished activities fade and the running one shows its progress; a long minimap scrolls to keep the current step in view. Clicking any of them opens its group or room tab, and the total duration bar counts activities inside groups by their own category.

### Fixed

- The dashboard keeps the chosen workspace when you come back from a session ("All sessions", the logo) or from the account pages, and after a reload. The address names it (`/?workspace=…`) and the browser remembers each account's last choice. A workspace address opened before signing in with a password, and the email telling an existing account it was added to a workspace, open that workspace; accepting an invitation still opens all workspaces.
- The dashboard's folder list uses the sidebar's remaining height (about 7 folders instead of 3 in a 1080p window, with no scroll bar when every folder fits), and the account footer shows the avatar beside the name again without first opening the account page. "Tous mes espaces" and "Séances personnelles" no longer show a placeholder workspace card, and the folder hint only appears where folders cannot be managed.
- "Gérer l’espace" > "Membres et invités": member names and e-mails are readable again, no longer squeezed one letter per line by a role selector that filled the row; on a phone the role and the remove button share one line under the name, and "Ajouter / inviter" lines up with its fields.
- Checkboxes sit on the same line as their text in the AI connectors (MCP) panel, the closing dialog's facilitator list, document import, the export block filter and PowerPoint notes option, and the workspace "Landscape Word documents" default. The MCP panel also lists the open session first, counts the selected sessions, explains what each permission shares or allows, and warns before granting write access to a session you can only read.

## [0.1.5] - 2026-10-06

### Fixed

- Number fields can be cleared and retyped: replacing 1 by 2 in "Minutes avant la fin" no longer means typing 12, then deleting the 1 (and 12 was saved meanwhile). The same applies to the backups kept, a form scale's minimum and maximum, and import durations. Leaving an empty field shows its saved value again.

### Security

- The image applies Debian security updates when it is built, instead of waiting for the Node.js base image to be rebuilt: it no longer carries the fixable HIGH and CRITICAL `libpcre2-8-0` and `perl-base` vulnerabilities that made the container scan fail.

## [0.1.4] - 2026-09-28

### Added

- Facilitators move to the previous or next block, and pause or resume, from the always-on-top window, without leaving a slideshow. Visitors' windows have no controls.
- Invitations are emailed when SMTP is configured: account, workspace and session invitations send their personal link to someone without an account, and a person who already has one is told where to find what they were added to. A session invitation says what the role allows: prepare and run, run, or follow. Without SMTP, the link is still shown to copy.
- Forgotten timers are stopped automatically: a timer whose current step is 24 hours past its time, with nothing changed on the session for 24 hours (the last step never marked as done, a test left running), or a paused timer untouched for 7 days. The current step counts for its planned duration and the organizers see it in their notifications. A session still in use, over several days included, is never interrupted.
- Administrators receive an email for each problem report or idea (when SMTP is configured), and authors are told in the app and by email when an administrator moves their report on. Nobody is emailed about their own action; each person can turn these emails off in their profile.

### Changed

- The report form offers its three kinds (a problem, an idea or a request, something else) as labelled cards instead of loose radio buttons.
- undici 8.11.2 (from 7.30.0). With a self-signed LLM certificate allowed (`LLM_ALLOW_SELF_SIGNED`), requests go through undici's own `fetch`, because Node's built-in `fetch` refuses an undici 8 agent.

### Fixed

- The sidebar scrolls when a zoomed-in browser leaves too little height; its bottom (account, report a problem) was cut off.

## [0.1.3] - 2026-09-25

### Added

- One Discussion per session, like a chat: conversations with a link's participants and private team conversations in a single list, each labelled with who can read it; replies go under the message they answer; resolved conversations stay visible, folded, for visitors too; organizers can start a conversation with a link's participants; visitors see the organizers' messages marked as the team's.
- Notifications for new visitor comments (organizers) and new problem reports (administrators), grouped per session until read. A short chime announces new ones to signed-in team members (never to visitors); it can be turned off from the notifications panel.
- Deleting a day from the overview.
- **+ Feedback (ROTI)** in the session contents adds a ready-made feedback form: a 1 to 5 rating of the time invested and an optional comment.
- Reordering agenda contents shows a grip and where the item will land.
- Past runs: every finished run is kept with the plan it started from and the actual durations, step by step. A day's first run keeps its initial plan, even after "Use actual durations", and any run's plan or actual durations can be put back into the agenda (Versions & activity › Runs, or "See past runs" when the timer ends).
- The timer shows the day's expected end time and the total time left, for facilitators and visitors, also in a thin always-on-top window.

### Changed

- The announcement banner can no longer be closed: it stays until an administrator removes it.
- The dashboard lists the sessions first; the welcome banner moved below them, and the constant "Espace privé" label is gone.

### Fixed

- Importing an agenda into a session fills its empty days instead of adding a duplicate "Jour 1" next to them.
- The facilitator picker closes on a click elsewhere, and lists people on one line each.
- Removing a block still to come during a run now puts the day ahead by its planned time (adding one still puts it behind); the timer said "on schedule".
- The notification badge appears within seconds and as soon as you come back to the window, without reloading the page.
- Editing the agenda after a finished run no longer resets the timer: the actual durations and "Restore the starting plan" / "Use actual durations" stay available.

## [0.1.2] - 2026-09-25

### Added

- My account & team is a page of its own, with a section per topic; your name at the bottom of the sidebar opens it.
- Visitor links can be shown again, with their QR code, after closing the share dialog. Older links offer a new address that keeps their scope and comments.
- An announcement banner written by administrators, shown to every account including on the sign-in page.
- Report a problem or suggest an idea from the application, without a GitHub account; administrators triage reports and can open a GitHub issue draft from their browser.
- Administrators read the server logs of every pod in the application.

### Changed

- The timer bar shows late and early as coloured badges (amber, red from five minutes, blue when early).

### Fixed

- Form response summaries by the AI are in the interface language, answer the facilitator's question first and show formatted headings and lists instead of raw Markdown.
- Failed requests and SMTP failures are logged with their route or error code.

## [0.1.1] - 2026-09-25

### Added

- Backups for administrators (Mon compte & équipe → Sauvegardes et données): scheduled once or twice a day, manual restore points, recovery of one session as a copy, full restore after an automatic safety backup.
- Export and import of all data as a passphrase-encrypted file, to copy production into a test environment or move to another installation.
- Test images of any branch from Actions → Publish test image, to try a change in development before merging.
- AI features no longer appear when no LLM is configured; the MCP connectors are also reachable from More actions.
- Administrators see the current activity before an update: installed version, sessions being facilitated or paused, people in the editor and visitor links being followed (Mon compte & équipe → Activité en cours).
- Every account sees the installed version at the bottom of "Mon compte & équipe"; release images, including release candidates, carry their exact version and commit.

### Changed

- Published forms stop accepting responses beyond 5,000 responses or 100 MiB of answers and images, and visitor links beyond 2,000 comments; deleting responses frees room again.
- A room of visitors sharing one internet address (meeting-room Wi-Fi, company proxy) can follow a public link without being throttled.

### Fixed

- Timers count down on the server clock: a phone or PC whose clock is off no longer shows a wrong remaining time or false overtime.
- A finished session no longer shows a stale position, "remaining" caption or schedule estimate in the timer bar.
- A session created between midnight and 02:00 in Geneva starts on the right day; the share dialog's expiry date no longer shifts by a day.
- On phones, the days, pages and forms strip keeps its names and no longer makes the whole editor scroll sideways.
- Escape closes the "More actions" menu and the side panels (AI assistant, block details, history) and returns focus to the button that opened them.
- Checkboxes sit on the same line as their label in the form editor, share dialog and AI assistant.
- Notes no longer show a 0 min duration on visitor links.
- The AI assistant proposes the requested changes with an Apply button instead of asking in text whether to proceed.
- An LLM that cannot be reached (network, DNS, unknown certificate authority) is reported as unavailable instead of "unusable answer", and the server log says why. `LLM_ALLOW_SELF_SIGNED` accepts an internally signed LLM certificate when its authority cannot be installed.
- MCP connectors see the installed version.

## [0.1.0] - 2026-09-24

### Added

- First release: French/English session planner with multi-day agendas, groups and parallel rooms, private columns and visitor links, live facilitation timer with sound reminders and a floating window, Pages and Forms, comments and mentions, workspaces, version history and recovery, imports and exports, optional OpenAI-compatible AI assistance, OIDC and SMTP, and an MCP connector.
