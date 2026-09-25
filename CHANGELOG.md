# Changelog

User-visible changes, newest first. Internal changes (refactors, tests, CI, dependency updates) are not listed; see the Git history. Format: [Keep a Changelog](https://keepachangelog.com/), versions follow `package.json`.

## [Unreleased]

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
