# Product research — MeetLoom

Audit dated September 23, 2026. Sources are official SessionLab documentation and the public SessionPlan repository. Inspection of the signed-in SessionLab interface supplements this audit. The features described below are not, by themselves, claims of delivered functionality. The user clarified the target: full functional parity with an original visual identity and useful ergonomics from SessionLab and SessionPlan. The [parity checklist](product-parity.md) records implementation gaps and acceptance scenarios; no non-excluded feature is unilaterally deferred until after validation.

## Selected approach

Build an independent workshop planner with direct agenda editing, automatic time calculation, colored categories, overview and live delivery. Keep MeetLoom's own visual identity and implementation.

SessionPlan offers a useful visual reference, but local persistence and snapshot sharing do not meet the requested organizer/visitor separation. Its dynamic-link backend is explicitly proprietary and absent from the public repository. Reusing the frontend would still require designing the server, identities, permissions, synchronization and internal deployment. [SessionPlan architecture](https://github.com/tim-peters/sessionplan/blob/main/ARCHITECTURE.md)

Its `package.json` declares AGPL-3.0-only, React 18.3, Vite 5.4, TypeScript, dnd-kit, i18next and Vitest. A fork is technically possible under that license, but the selected approach avoids depending on this codebase and its missing backend. No SessionPlan code is to be copied into MeetLoom. [Dependencies and license](https://github.com/tim-peters/sessionplan/blob/main/package.json), [license text](https://github.com/tim-peters/sessionplan/blob/main/LICENSE)

## What SessionLab provides

A block contains a title, duration, category, description and additional fields such as objectives, materials, instructions and facilitator. Times recalculate when durations or ordering change. Blocks can be dragged to move them. [Blocks](https://help.sessionlab.com/en/articles/4472968-create-a-block-in-sessionlab)

Groups collect multiple blocks, collapse and move as a unit. Their duration is calculated from their children. [Groups](https://help.sessionlab.com/en/articles/4472976-how-to-use-groups-in-your-sessions)

Parallel rooms contain their own blocks and groups. The overall duration is the longest room. [Breakouts](https://help.sessionlab.com/en/articles/4477130-breakout-rooms)

A locked time acts as an anchor; unused time and overlaps are highlighted. The first anchor can cause preceding times to be calculated backward. [Time calculation](https://help.sessionlab.com/en/articles/4473024-time-calculation-locking-blocks-and-resolving-timing-issues-in-your-session)

A session can span multiple days, with individual day and overview views. [Multi-day sessions](https://help.sessionlab.com/en/articles/4456599-multi-day-session-overview)

Live tracking supports automatic or manual advancement, remaining time, schedule deviation and extensions. Documented visual thresholds are 20% and 5% remaining. At the end, users can retain actual durations or return to the original plan. The documentation states that tracking is unavailable with parallel rooms. [Time Tracker](https://help.sessionlab.com/en/articles/6103716-time-tracker-track-your-session-timing)

AI generates agendas and activities, suggests changes, rewrites and translates. Using information from other sessions is an explicit context choice. MeetLoom supports generation and revision from a brief or agenda, authorized session/workspace context, Pages/Forms and document conversion. Block/session libraries and files attached to blocks remain excluded; importing a document to create an agenda is a distinct supported workflow. [AI Assistant](https://help.sessionlab.com/en/articles/8930897-design-and-adjust-your-agenda-with-the-ai-assistant)

SessionLab already supports French and English. Localization is therefore a requirement for MeetLoom and any possible SessionPlan base; SessionPlan's code declares German and English. [SessionLab languages](https://help.sessionlab.com/en/articles/4438369-how-can-i-change-the-language-in-sessionlab), [SessionPlan configuration](https://github.com/tim-peters/sessionplan/blob/main/src/lib/i18n.ts)

## Visibility and confidentiality are different

In SessionLab, hiding a column changes the planner presentation; a collaborator can still access its content in block details. Existing fields can be renamed, resized or hidden, but that action is not a permission. [Column layout](https://help.sessionlab.com/en/articles/8717272-customize-your-session-planner-layout)

SessionLab's visitor link allows reading and commenting without an account. It can select days, Pages or Forms, but the documentation states that a block or column cannot be hidden within a shared day. Links can be disabled. [Visitor links](https://help.sessionlab.com/en/articles/4423478-visitor-links)

Online Agenda is a separate, simplified mode: times, titles and categories, without comments or editing. It is not a configurable field-level privacy policy. [Simple online agenda](https://help.sessionlab.com/en/articles/8027717-share-a-simple-online-overview-of-your-agenda)

SessionPlan snapshot-sharing code compresses the workshop object into the URL fragment. Compression is not access control: recipients can recover included values. Its synchronization client exchanges a workshop object using a link key and versions; the corresponding server is not included in the repository. [Snapshot sharing](https://github.com/tim-peters/sessionplan/blob/main/src/lib/workshopUrl.ts), [server client](https://github.com/tim-peters/sessionplan/blob/main/src/lib/workshopServer.ts)

### MeetLoom design requirements

- Separate each column's display setting from its authorized audience.
- Support at least two audiences: authenticated members authorized for the session, and visitors holding an active link. Signing in alone must not grant access to every session.
- Keep presentation notes and confidential instructions in a column restricted to authorized organizers and facilitators.
- Build a server-filtered visitor object using an explicit allowlist. Never send other values and then hide them with CSS.
- Apply the same privacy rules to details, live views, exports and anonymous requests; do not embed private notes in initial HTML or errors.
- Generate unpredictable random tokens with revocation and configurable expiry. A link is a transferable capability; revocation must prevent later reads.
- Test actual HTTP responses using private sentinels, revocation, expiry and access to another session. These domain/security tests precede the maintained end-to-end suite.

## Scope matrix

The Done and To plan columns below belong to the initial research matrix and are not implementation tracking. Every non-excluded row remains in the parity target without an arbitrary first-version/later split. Consult the parity checklist for current evidence.

| Feature                                                    | Observed reference                                          | MeetLoom target                                                                          | Done | To plan |
| ---------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---- | ------- |
| Session dashboard, creation, duplication and deletion      | SessionLab; SessionPlan is browser-centered                 | Parity                                                                                   |      |         |
| Blocks, durations, colors, facilitators and direct editing | Both                                                        | Parity                                                                                   |      |         |
| Reordering and immediate recalculation                     | Both                                                        | Parity                                                                                   |      |         |
| Collapsible groups/sections                                | Both                                                        | Parity                                                                                   |      |         |
| Multiple days                                              | SessionLab; SessionPlan model has one date                  | Parity, with model and UI validated together                                             |      |         |
| Locked times and conflict warnings                         | Both support anchors                                        | Parity with an explicit, tested rule                                                     |      |         |
| Custom columns and audiences                               | SessionLab renames existing fields                          | Parity plus server-enforced audiences                                                    |      |         |
| Accounts and session permissions                           | SessionLab                                                  | Parity                                                                                   |      |         |
| Revocable visitor links and read-only agenda access        | SessionLab has two sharing modes                            | Parity with a visitor preview                                                            |      |         |
| Delivery, pause, next, extension and schedule deviation    | Both have live mode                                         | Parity                                                                                   |      |         |
| Warning sound before the end                               | No configurable early threshold found in this audit         | Requested addition: minutes and percentage                                               |      |         |
| Floating bar over a presentation                           | Not documented in inspected sources                         | Requested addition with capability detection                                             |      |         |
| French and English in all views                            | SessionLab yes; SessionPlan DE/EN                           | Parity                                                                                   |      |         |
| Internal AI, generation and editable suggestions           | SessionLab provides hosted AI                               | Parity with a configurable server adapter                                                |      |         |
| Backup export and agenda printing                          | Both                                                        | Parity including advanced layout                                                         |      |         |
| Concurrent editing and conflict resolution                 | SessionLab; versioned client synchronization in SessionPlan | Parity with an access model                                                              |      |         |
| Comments, mentions and detailed history                    | SessionLab                                                  | Parity                                                                                   |      |         |
| Full parallel-room structure                               | Both                                                        | Parity; the timer runs a parallel block as one step (longest room) at the user's request |      |         |
| Word/PPT/PDF imports and advanced exports                  | SessionLab                                                  | Parity                                                                                   |      |         |
| Pages, Forms, tasks and reminders                          | SessionLab                                                  | Parity                                                                                   |      |         |
| Parking lot                                                | SessionLab                                                  | Explicitly excluded for now                                                              |      |         |
| Block/session library                                      | Both                                                        | Explicitly excluded for now                                                              |      |         |
| Block attachments                                          | SessionLab                                                  | Explicitly excluded for now                                                              |      |         |

SessionPlan's public model contains blocks, groups, breakouts, facilitators, timing anchors and one workshop date. Absence from that model does not prove absence from any private offering. [Workshop model](https://github.com/tim-peters/sessionplan/blob/main/src/types/workshop.ts)

## Sound alerts

SessionPlan's public code plays sounds at startup, block changes and completion. It defines no configurable early-warning threshold. [Live mode](https://github.com/tim-peters/sessionplan/blob/main/src/hooks/usePlayMode.ts)

The requested global choices include 120 or 60 seconds remaining, or 20% or 10% remaining, with audio enablement and volume. A percentage refers to block duration, not total session time. The current implementation selects one early-warning threshold at a time; simultaneous multiple thresholds are not implemented.

Implemented rules: trigger once per block execution when crossing the threshold; do not sound immediately if a block is shorter than a fixed threshold; suspend alerts while paused; retain the already-played warning after extending the same execution. The controlling browser enables sound through the start gesture, other authorized devices opt in, and visitor views remain silent. **Preview sound** initializes and checks audio before presenting. Time derives from timestamps rather than a counter assumed to run once per second.

## Floating bar and PowerPoint

**Document Picture-in-Picture** is the first option in desktop Chrome/Edge. It opens an HTML window above other windows and requires a user gesture. Users choose its position, and it closes with the source page. MeetLoom provides a compact current-block, remaining-time, progress and schedule-deviation view and detects API availability at runtime. [Chrome documentation](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)

The API requires a secure context and is unavailable from an ordinary iframe. The specification also warns that scripts in hidden windows can be throttled; floating-display refresh must account for this. [Document PiP specification](https://wicg.github.io/document-picture-in-picture/)

Fallback: a separate display window with instructions for pinning it on Windows through PowerToys (`Win+Ctrl+T`). The shortcut keeps a window above others when focus changes, although Microsoft does not guarantee priority over other always-on-top windows. [PowerToys Always On Top](https://learn.microsoft.com/fr-fr/windows/powertoys/always-on-top)

Overlay behavior with the actual PowerPoint presentation, full-screen mode, multiple monitors or a remote session still requires manual verification. The documented API supports the approach; it is not proof of a test on that workstation. For remote presentations, also check full-screen sharing: sharing only the PowerPoint window can exclude the floating window. The floating public display must not expose private notes.

## Internal AI and acceptance criteria

Do not hard-code the assumed model name “Qwen 3.8.” Provide server settings for the internal URL, compatible protocol, actual model identifier, access secret and request limits. The endpoint is administrator configuration; the browser never receives its key. Agenda suggestions must pass schema validation and preview before application, with undo support. Make no implicit external call when internal AI is not configured.

The first version must undergo manual preparation and delivery validation. Unit/integration tests already cover timing, live transitions, alerts and especially visitor projection. The maintained end-to-end suite follows user validation of that version, as requested. Automatic dependency-update merging must remain gated until its required security checks and end-to-end tests are effective.

OpenShift manifests, CI and dependency monitoring are covered by the separate RetroGemini engineering audit. Do not claim deployment validation until the manifests have actually run on the target cluster.
