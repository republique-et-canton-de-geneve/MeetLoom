# MeetLoom — implementation plan and functional parity

## Decision

A free, independent, self-hostable application, built from scratch with TypeScript, React and Express. SessionLab workflows and RetroGemini engineering practices are references. No SessionLab code or library content is copied. SessionPlan is an ergonomics reference, not a dependency.

The target is equivalent SessionLab functional coverage, with the three explicit exclusions below, an original visual identity and ergonomics informed by the strongest SessionLab and SessionPlan workflows. Do not reproduce SessionLab's design or colors. The [parity checklist](product-parity.md) records documented features, current gaps and acceptance criteria; a usable foundation is not evidence that parity has been achieved. The maintained end-to-end suite and automatic dependency-update merging depend on user validation. Unit and server integration tests already cover identity, permissions, privacy and timing calculations.

## Implemented foundation — acceptance testing remains required

- Local accounts, first-administrator setup, persistent sessions and collaborators with roles; optional OIDC and SMTP integrations.
- Workspaces, administration, dashboard, folders, metadata, session creation, duplication, archiving and lifecycle reporting.
- Multi-day agendas, block editing, categories, sections, facilitators, recalculated durations and times, movement, duplication and recoverable deletion.
- Nested sequential groups, zero-duration notes and parallel rooms. Group duration is the sum of its children; parallel duration is the longest room. The linear timer follows activities inside groups, skips notes and runs a parallel block as one step lasting as long as its longest room (a user decision during acceptance; extra time goes to the last activity of the longest room).
- Internal client, tag and folder metadata; custom categories and colors. Visitors receive only categories used by the public agenda.
- Customizable columns and presentation notes restricted to the team by default. Anonymous projections remove internal data on the server.
- Visitor and simplified Online Agenda links with random tokens, revocation, expiry, scoped days/Pages/Forms and an initial destination. Public comments are separate from private discussions.
- Shared timer with start, pause, previous/next block, progress, schedule deviation, configurable minute/percentage warning sound, tone and volume. Visual thresholds are independently fixed at 20% and 5% remaining.
- Document Picture-in-Picture progress window where supported, with a separate-window fallback.
- Safe rich text, checklists and aggregated materials; Pages and versioned, published Forms, including bounded image responses stored privately.
- Presence, three-way conflict handling, threaded comments, mentions, notifications, named versions, change history and recovery bins.
- Optional server-side Chat Completions-compatible adapter for internal Qwen: private conversations, explicit contexts, instruction sets, reviewed typed proposals, form-response summaries and bounded export suggestions. Scoped personal-token MCP access is available.
- French and English UI; JSON/CSV, configurable browser PDF printing, DOCX and PPTX exports, clipboard tables and document import with preview.
- Docker, SQLite for local use, PostgreSQL and OpenShift guides/installers, CI and dependency monitoring.

These implementation statements do not replace the per-workflow evidence and open checks in [product-parity.md](product-parity.md) and [manual-qa.md](manual-qa.md).

## Contracts and security

Types are defined in `shared/model.ts`. Every `/api/sessions/:id/*` route requires authentication and access to that session, even when the identifier is known. Anonymous clients use scoped visitor or published-form routes. These responses exclude internal fields, members, private comments and secrets; explicitly enabled visitor comments are a separate public channel. Agenda writes require an expected version and return HTTP 409 on conflict instead of overwriting a collaborator's work. AI provider settings come only from the server environment.

SQLite supports a local instance. PostgreSQL is required for OpenShift. Lightweight agenda/timer polling, server timestamps and concurrency checks provide collaboration; this is not a character-level CRDT editor.

Zero-minute activities can represent milestones. The first locked start time determines earlier block times by backward calculation; later locks show gaps and overlaps without moving the selected anchors.

Groups and rooms preserve descendant fields under the same column permissions as top-level blocks. Public projection reconstructs each level from an allowlist. Imports and duplication create new block and room identifiers. An agenda allows up to 1,000 blocks, five nesting levels and twelve rooms per parallel sequence. Computed durations are normalized on the server. Rooms start together; internal time locks show their gaps and overlaps. A group's scheduled span can therefore exceed the sum of its activity durations.

The timer snapshots the day's planned block durations when started. Schedule deviation compares elapsed time against those initial durations; extending a block changes its remaining time without erasing accumulated delay. Pauses count toward delay. Starting uses the current time by default. **From planned start** uses the agenda date, first calculated start and timezone. It requires a valid time in the past: the first occurrence is selected during an autumn clock overlap, and nonexistent spring times are rejected. With automatic advancement, already elapsed blocks are caught up immediately, including zero-minute milestones. Gaps between locked starts do not automatically pause delivery; add a break block if that time must be played.

Actual durations accumulate active time across visits to each block and exclude pauses. Finishing preserves the current agenda. Explicit commands can then restore the initial durations or apply actual durations; unvisited activities become zero when applying actual results. A new start takes a new baseline, and resetting clears timer measurements. A block added during delivery uses its current duration as its baseline until the next start.

The last automatic transition can be recovered by extending the preceding block. If its new duration still covers the current moment, the timer returns to it with elapsed time preserved; otherwise the current block is adjusted. Manual navigation or an explicit stop clears that recovery opportunity. See the timing criteria in [product-parity.md](product-parity.md).

## Environment-dependent validation

The overlay depends on the browser, operating system and PowerPoint mode; a universal guarantee across full-screen modes would require a native companion. The Qwen model and exact URL remain configurable. Real internal OpenShift, Qwen, identity-provider and SMTP access has not been available for this work. Local tests and simulated providers must not be reported as successful validation against those real services.

## Remaining acceptance work

The listed feature families have implementations; their full functional and ergonomic equivalence remains subject to the checklist. Remaining comparisons cover rich editing, tasks/materials, groups/notes and parallel rooms, Overview/Multi Plan, timing anchors and delivery, collaboration, threaded comments, recovery and versions, Visitor/Online sharing, configurable exports, document conversion, Pages/Forms, workspaces/administration and AI workflows. Do not turn an open acceptance scenario into a new exclusion or an unapproved postponement. Enter in a block title creates the next block and focuses its title; duration and time editing remain directly accessible.

## Requested exclusions

Parking lot, block/session library and block attachments. No other functional exclusion has been approved. A real dependency on an exclusion must be identified in the checklist without removing unrelated uses: generating a new PPTX or importing a document is not attaching a file to a block.
