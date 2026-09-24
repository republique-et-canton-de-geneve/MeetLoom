# Changelog

User-visible changes, newest first. Internal changes (refactors, tests, CI, dependency updates) are not listed; see the Git history. Format: [Keep a Changelog](https://keepachangelog.com/), versions follow `package.json`.

## [Unreleased]

### Changed

- Published forms stop accepting responses beyond 5,000 responses or 100 MiB of answers and images, and visitor links beyond 2,000 comments; deleting responses frees room again.
- A room of visitors sharing one internet address (meeting-room Wi-Fi, company proxy) can follow a public link without being throttled.

## [0.1.0] - 2026-09-24

### Added

- First release: French/English session planner with multi-day agendas, groups and parallel rooms, private columns and visitor links, live facilitation timer with sound reminders and a floating window, Pages and Forms, comments and mentions, workspaces, version history and recovery, imports and exports, optional OpenAI-compatible AI assistance, OIDC and SMTP, and an MCP connector.
