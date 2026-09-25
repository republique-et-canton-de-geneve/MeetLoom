# Changelog

User-visible changes, newest first. Internal changes (refactors, tests, CI, dependency updates) are not listed; see the Git history. Format: [Keep a Changelog](https://keepachangelog.com/), versions follow `package.json`.

## [Unreleased]

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

## [0.1.0] - 2026-09-24

### Added

- First release: French/English session planner with multi-day agendas, groups and parallel rooms, private columns and visitor links, live facilitation timer with sound reminders and a floating window, Pages and Forms, comments and mentions, workspaces, version history and recovery, imports and exports, optional OpenAI-compatible AI assistance, OIDC and SMTP, and an MCP connector.
