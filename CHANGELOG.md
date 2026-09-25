# Changelog

User-visible changes, newest first. Internal changes (refactors, tests, CI, dependency updates) are not listed; see the Git history. Format: [Keep a Changelog](https://keepachangelog.com/), versions follow `package.json`.

## [Unreleased]

## [0.1.3] - 2026-09-25

### Added

- One Discussion per session, like a chat: conversations with a link's participants and private team conversations in a single list, each labelled with who can read it; replies go under the message they answer; resolved conversations stay visible, folded, for visitors too; organizers can start a conversation with a link's participants; visitors see the organizers' messages marked as the team's.
- Notifications for new visitor comments (organizers) and new problem reports (administrators), grouped per session until read.
- Deleting a day from the overview.
- Reordering agenda contents shows a grip and where the item will land.
- Past runs: every finished run is kept with the plan it started from and the actual durations, step by step. A day's first run keeps its initial plan, even after "Use actual durations", and any run's plan or actual durations can be put back into the agenda (Versions & activity › Runs, or "See past runs" when the timer ends).
- The timer shows the day's expected end time and the total time left, for facilitators and visitors, also in a thin always-on-top window.

### Changed

- The announcement banner can no longer be closed: it stays until an administrator removes it.
- The dashboard lists the sessions first; the welcome banner moved below them, and the constant "Espace privé" label is gone.

### Fixed

- Importing an agenda into a session fills its empty days instead of adding a duplicate "Jour 1" next to them.
- The facilitator picker closes on a click elsewhere, and lists people on one line each.
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
