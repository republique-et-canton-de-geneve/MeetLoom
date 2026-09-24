# Agent handoff

Last updated: September 24, 2026. Read this file first when continuing in Codex, Claude, or another coding agent. Update it at every stopping point; do not rely on conversation history.

## Current stopping point

**Acceptance round 6 (September 24, 2026).** The user accepted the parallel-room rule and asked for the E2E suite before merging to `main`:

- **Accounts like SessionLab:** self-service sign-up is now **open by default** once the first administrator exists; each account manages its own sessions. Administrators can restrict it to email domains or close it in “Paramètres de l’installation”. The first account is still the setup/administrator account.
- **E2E suite** (`e2e/`, Playwright 1.56.1, `npm run test:e2e`): first-account setup, self-service sign-up and session isolation, sign-in/wrong password and FR→EN, agenda editing persisted across reload (durations, total, inserted group), visitor link privacy (a team-only note is stored but absent from the visitor page and its API responses), and facilitation (next/previous resumes, actual duration chip, visitor live timer and always-on-top button, pause propagation, reset). 7 journeys, stable over consecutive runs. CI job “End-to-end journeys” is required by “CI Success”; the release workflow also runs them on the exact commit.
- **Dependabot:** already configured (npm daily, GitHub Actions and Docker weekly). New `.github/workflows/dependabot-auto-merge.yml` enables auto-merge for patch updates and development minor updates only; it depends on the user enabling branch protection (required “CI Success”) and “Allow auto-merge” (documented in `docs/deployment.md`).

Next steps for the user: configure Docker Hub secrets/variable, protect `main`, merge PR #1, publish `v0.1.0`, then run the OpenShift installer in development. The user deploys from Windows (PowerShell 7) and the cluster pulls through an internal registry mirror: pass the mirrored reference to `-Image` (the user knows it; never write internal hostnames in the repository), with `-DatabaseImage` if `quay.io` is unreachable (see deployment.md).

**Acceptance round 5 (September 24, 2026).** Fixed on `codex/meetloom-v1`:

- **Parallel rooms and actual time (design decision to confirm with the user):** the timer measures a parallel block as one step because all rooms run at once. “Use actual durations” gives the actual time (whole minutes) to the longest room(s), scaling their activities proportionally with largest-remainder rounding so they add up exactly; shorter rooms keep their plan unless the actual time is shorter, which caps them. Groups inside a room are scaled through their activities; a nested parallel keeps its plan. “Restore plan” also restores room activities, because a run now captures their planned durations at start. Rooms are not limited to one activity. `spreadParallelActual` in `shared/domain.ts`; tests in `tests/timer-parallel.test.ts`.
- **Self-service sign-up:** administrators enable it in “Paramètres de l’installation” (off by default), optionally restricted to email domains. `POST /api/auth/signup` creates a non-administrator account and signs it in; `/api/auth/status` exposes `signupEnabled`/`signupDomains`; `GET /api/admin/settings` and `PUT /api/admin/settings/signup` are admin-only. Without SMTP the address is not verified: keep it for internal networks. Tests: `tests/signup.test.ts`.
- **Admin settings panel** (`src/AdminSettings.tsx`): sign-up policy plus a read-only state of SMTP, OIDC and AI (model names). Services stay operator configuration (environment/ConfigMap/Secret), never browser-editable, by design. Lost passwords without SMTP: “Lien de récupération” in account administration.
- **Always-on-top window for visitors:** the visitor page's live timer has the same button; the window logic is the shared `useFloatingWindow` hook in `src/Timer.tsx`.
- **Minimap:** clicking a group or parallel block scrolls to its header (container titles are registered like block titles).

Deployment readiness (answered to the user): the image, Docker Hub release workflow and OpenShift installer are in place. The release workflow only runs from `main` or a published release, so PR #1 must be merged first; it also needs the `DOCKERHUB_REPOSITORY` variable and `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secrets. The documented gate (nominal E2E suite before the first release) is the user's call. Not yet exercised on a real cluster.

**Acceptance round 4 (September 24, 2026).** Fixed on `codex/meetloom-v1`, modelled on the SessionLab screenshots the user supplied:

- **Groups and parallel activities are logical containers:** a compact header (`containerHeader` in `src/Editor.tsx`) with only the start time and padlock, the duration computed from the activities (plain text, not a field), the actual duration once passed, a collapse arrow, the title, and delete. No description, category, assignee or columns. Groups are light blue, parallel activities light orange.
- **Parallel rooms as tabs** (`roomsArea`): “Vue d’ensemble” (side by side), one tab per room with its duration and, once passed, the block's actual duration, and “Ajouter une salle”. A room tab shows its activities as ordinary rows, a rename field and a delete button (when more than one room). No side panel is needed.
- **Overlaps:** a red banner states “N min de chevauchement entre A et B”. Sub-minute differences (fractional legacy durations, or a lock set at a displayed time) are neither gaps nor overlaps (`scheduleTreeDay`), which removes the false “overlaps the previous block” warning after locking/unlocking. Test in `tests/whole-minutes.test.ts`.
- **Countdown before a scheduled start:** the timer bar and the always-on-top window turn blue with an amber “DÉBUT DANS”; clocks past an hour read h:mm:ss (`clock` in `src/Timer.tsx`).

Local verification: `npm run check` passed with 275 tests, both TypeScript projects and the build; the same 275 tests passed on PostgreSQL 16; formatting checks passed. Browser evidence is in [manual-qa.md](manual-qa.md).

**Acceptance round 3 (September 24, 2026).** Fixed on `codex/meetloom-v1`:

- **Day start and first block:** the day's first block always starts at the day's start time and is shown locked (a non-toggleable padlock). Editing the day's start time moves it; editing the first block's time changes the day's start time and clears any stale lock on it. The scheduler no longer back-calculates the day from the first lock found (`scheduleTreeDay`); later locks create gaps or expose overlaps. This also fixes “start from scheduled time” beginning a minute early: a 1-minute first block followed by a block locked at the day's start used to move the day one minute earlier. Tests: `tests/domain.test.ts`, `tests/tree.test.ts`, `tests/planned-start.test.ts`.
- **Groups are containers:** blocks inside a group render with exactly the same row as blocks outside it (`renderRow` in `src/Editor.tsx`), with the same insert line, delete, lock, drag handle and keyboard shortcuts (Enter, Alt+arrows and Backspace work within the group). Parallel rooms keep the side-by-side outline.
- **Drop indicator:** a dragged block, including a group child, shows the same green line as the insert line where it will land.
- **Insert line:** clicking anywhere on the line opens the menu, not only its “+”.
- **Padlock:** an unlocked padlock disappears as soon as the pointer leaves the time (it no longer stays visible through focus after a click).
- **Always-on-top window:** at its default size (560×188) it shows everything again, at the previous text sizes. Shrinking scales text down and drops the delta and position, then the kicker, then the title; the remaining time and the progress bar always stay.

Local verification: `npm run check` passed with 273 tests, both TypeScript projects and the build; the same 273 tests passed on PostgreSQL 16; formatting checks passed. Browser evidence is in [manual-qa.md](manual-qa.md).

**Acceptance round 2 (September 24, 2026).** The user's second round of findings, all addressed on `codex/meetloom-v1`:

- **Timer, going back (corrected rule):** the clock keeps running for the block you return to. Leaving with 30 s left and coming back 10 s later leaves 20 s. `previous` resumes the earlier block with its own time plus the detour (the time on the abandoned later blocks, pauses excluded), against its current duration; the left block becomes upcoming again. This replaces round 1's “detour discarded” rule. `tests/timer-revisit.test.ts` was rewritten accordingly.
- **Actual durations:** once the timer has passed a block, its duration cell shows the actual duration (whole minutes, “< 1 min”) in an amber style, with the exact time and the planned duration on hover; a click edits the planned duration. `ActualDurationsContext` and `DurationField`'s `blockId` in `src/TimeFields.tsx`.
- **Whole minutes:** “Use actual durations” rounds down to whole minutes; displayed and typed durations are whole minutes (the 2.5242… min total is gone). `tests/whole-minutes.test.ts`.
- **Scheduled start:** always allowed. A start still ahead counts down (“DÉBUT DANS”) and then runs on time; `timerView().startsInSeconds`. `tests/planned-start.test.ts`.
- **Parallel rooms in the timer:** a parallel block is one timer step lasting as long as its longest room; +1/+5 lengthen the last activity of that room (`extendBlock` in `shared/domain.ts`). All refusals were removed (domain, validation, run API, transfers, UI). This deliberately differs from SessionLab. `tests/timer-parallel.test.ts`.
- **Inline editing without the side panel:** a “+” in the gap between rows inserts a block, group, note or parallel activities there (`src/InsertMenu.tsx`); a trash icon deletes a block; groups and parallel blocks are framed around their activities, which can be added inline and dragged into or out of groups and rooms (`relocateBlock`/`insertBlockInto` in `src/block-tree.ts`, `tests/block-tree.test.ts`, `src/GroupOutline.tsx`); a padlock beside each start time locks/unlocks it; duration steppers read “− 10 min +”.
- **Smaller fixes:** gap between the start menu and “Animer la séance”; a sign-in hint explaining that accounts come from an administrator's invitation (or organization sign-in when OIDC is on); the timer shows “+1” like “+5”; the details panel names the block it shows, replays a short highlight when switching, and outlines the block's row; the always-on-top window scales its text with its size and hides the title, position and delta as it shrinks, down to the clock alone.

Local verification of round 2: `npm run check` passed with 272 tests, both TypeScript projects and the production build; the same 272 tests passed on PostgreSQL 16; formatting checks passed. Browser evidence is in [manual-qa.md](manual-qa.md). Drag and drop was exercised with dispatched DragEvents; physical mouse dragging in a real browser still needs the user's check.

**Acceptance round 1 (September 24, 2026).** The user started manual acceptance and asked agents to work directly on `codex/meetloom-v1` (no intermediate branch). Their first findings, all addressed in this round:

- **Timer: going back to a block restarted it from zero (reported as the most important bug).** The `previous` action now resumes the earlier block from the time already spent on it, against its current duration, so a block extended in the agenda (or with +1/+5 min once back on it) continues its countdown instead of restarting. Following the SessionLab reference video, the block being left becomes upcoming again: its detour time is discarded, and it starts fresh when reached. The schedule delta still counts the detour. Implementation: `transitionRun` in `shared/domain.ts`; `actualDurations` now only holds blocks before the current one. `tests/timer-revisit.test.ts` (18 tests; 17 fail on the previous code) covers the reported scenario, pause, overtime, shortened blocks, multiple steps back, round trips, actual/planned durations, delta, automatic advance, legacy runs, the visitor projection, and the HTTP API.
- **Timer alerts** (`timerAudioStep` in `src/Timer.tsx`): the advance warning and end chime re-arm when the remaining time goes back above their trigger point (an extension, or a revisited block given more time), and a revisit already past the warning does not replay it. Two older audio tests that encoded the restart behavior were rewritten.
- **“Depuis l’heure prévue” was greyed out without explanation.** The option now states why (for example “disponible dès 09:00”, a date when the start is on another day, “ajoutez d’abord un bloc”, or a schedule to check), and the control has an explanatory tooltip. The closed control keeps a fixed width so the longer option text never widens the row. Tests: `tests/planned-start.test.ts`.
- **“Affichage des horaires” layout:** a global `label { flex-direction: column }` stacked each label above its control. The time display row is now one line (label, bordered timezone select, “12 h” checkbox), wrapping on narrow screens.
- **Dashboard sidebar:** the second “ESPACE DE TRAVAIL” caption and the “Un espace qui vous appartient” card were removed; the card covered folder buttons. The folder list now fills the remaining height and scrolls, with the account footer kept at the bottom.
- The duration stepper buttons were announced as “Réduire la durée de Durée de …”; they now read “Réduire : Durée de …”.

Local verification of this round: `npm run check` passed with 251 tests, both TypeScript projects, and the production build; the same 251 tests passed on a disposable PostgreSQL 16 database; formatting checks passed. Browser evidence is in [manual-qa.md](manual-qa.md). The user said more annotated screenshots will follow: continue acceptance fixes from them.

The previous continuation (merged through PR #2 into `codex/meetloom-v1`) released rate-limiter stores on `createApp().close()`, aligned the dashboard workspace selector, and synchronized `<html lang>` with a restored locale.

The preceding Codex checkpoint remains valid: **validated code commit** `10b4f1a28e0b0d27429f0c541675263d2f9ea1e8` passed [CI 35885304817](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35885304817) (SQLite/PostgreSQL, types, build, formatting, audit, manifests) and [Security 35885304655](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35885304655) (exact image build, arbitrary-UID/read-only-root smoke test, Trivy, CodeQL), plus the separate CodeQL findings check `107264308348`. Its documentation-only follow-up `38d24c0` also passed every check on PR #1.

The implementation is in [MeetLoom PR #1](https://github.com/republique-et-canton-de-geneve/MeetLoom/pull/1), on `codex/meetloom-v1`. The PR remains a draft for manual acceptance. The default branch still contains the original repository initialization until the PR is merged. Check out the implementation branch to run the app; README badges and the Render button on the default branch cannot represent this unmerged version yet.

`origin` is `https://github.com/republique-et-canton-de-geneve/MeetLoom.git`. The former personal remote is named `personal`; the user will archive that repository. Both initial Git histories were preserved with a normal merge. Never force-push or recreate the repository to simplify its history.

## Requirements and decisions to preserve

- Build an independent, free, self-hosted SessionLab functional counterpart. Use an original visual identity, not a copy of SessionLab colors or design. SessionPlan is an ergonomics reference; none of its AGPL code was imported.
- The application must support French **and** English. Repository documentation, README, guides, and agent instructions must be **English**, following RetroGemini. Speak French to the user unless asked otherwise.
- Explicit exclusions: Parking lot, block/session library, and attachments in blocks. Temporary document import and images in Forms are separate implemented features.
- Protect internal columns and presenter notes through server-side projections. Anonymous links must not receive hidden content, even in exports or network responses.
- Keep configurable advance sound warnings (minutes or percentage), the shared timer, keyboard-friendly agenda editing, and the floating presentation window. Native PowerPoint overlay behavior is environment-dependent.
- LLM integration is optional and server-side. The organization's actual endpoint/model identifier has not been supplied. Never add a public provider fallback or send private data without the selected scope.
- Engineering, documentation, CI, Dependabot, CodeQL, release artifacts, Docker Hub publication, and generic OpenShift/Kubernetes installation follow the audited RetroGemini practices. See [engineering-reference.md](engineering-reference.md).
- Keep deployment descriptors generic. The user's future dev/prod namespaces are operator configuration, not reusable defaults. The user deploys manually; GitHub must not receive OpenShift credentials.
- Keep the Render installation option, with its documented ephemeral-storage limitation on the free demo plan.
- No maintained browser E2E suite or dependency auto-merge until the user accepts the initial application. Unit/API tests are already required and available.
- No release, merge, Docker Hub publication, Render installation, or OpenShift deployment has been authorized for this implementation checkpoint.

## Completed work and evidence

The app and engineering files are already implemented; do not restart the project. Read [status.md](status.md), [product-parity.md](product-parity.md), and [manual-qa.md](manual-qa.md) to distinguish implemented capabilities from verified behavior and remaining acceptance scenarios. Read [ARCHITECTURE.md](../ARCHITECTURE.md) before editing cross-module contracts.

The documented browser checks cover planning, sharing/privacy, collaboration, forms, imports/exports, timing, FR/EN, responsive layouts, and a mock AI proposal/application flow. They are manual evidence, not a maintained E2E suite and not certification of every SessionLab scenario.

Before the final security correction, 219 tests passed on each of SQLite and PostgreSQL. The organization repository's [CI run 35877168096](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35877168096) passed. Its [Security run 35877168133](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35877168133) built the exact Dockerfile and passed arbitrary-UID/read-only-root operation and the blocking Trivy policy.

The checkpoint correction replaces the custom rate limiter with the already-transitive `express-rate-limit` dependency, now declared directly. It preserves `429`, `RATE_LIMITED`, and `Retry-After`; uses IPv6 subnet aggregation; and adds a shared 20-attempt/15-minute account budget for profile updates and account deletion. Tests cover alternating sensitive routes, IP rotation, account isolation, expiration, and the explicit test-only bypass. Three unused imports reported by CodeQL were removed. No database schema or UI language change was made. Local `npm run check` passed with 225 tests, both TypeScript checks, and a production build. The dependency audit reported zero vulnerabilities. The current revision's hosted checks are available on PR #1.

GitHub initially rejected CodeQL uploads because automatic Default setup conflicted with the versioned workflow. The user approved matching RetroGemini's advanced workflow. Default setup was disabled **only on MeetLoom**, and the existing workflow now uploads successfully. Do not re-enable Default setup alongside it. The first successful analysis reported 11 missing-rate-limit alerts because it did not recognize the custom middleware, plus three unused-import notes. The actual weak account budgets were strengthened rather than suppressing findings. Check the current PR's separate CodeQL result as well as the workflow conclusion: a successful analysis job alone does not mean there are no security alerts.

Earlier Trivy findings came from the base image's bundled global npm, not application dependencies. The runtime now removes npm/npx after installation and starts directly with Node. The SARIF action explicitly honors the existing blocking fixable HIGH/CRITICAL policy. Do not weaken that policy or restore npm to the runtime without a reason.

## Resume procedure

1. Run `git status --short`, `git branch --show-current`, and `git remote -v`. Preserve any user changes. Fetch `origin` and inspect PR #1's current head and checks before assuming this record is current. Work directly on `codex/meetloom-v1`, as the user requested.
2. Read `AGENTS.md`, this file, `docs/status.md`, and the relevant parity/manual-QA sections. Current work is acceptance preparation, not a blank-slate implementation.
3. With Node.js 24, run `npm ci`, `npm run check`, and `npm run format:check` when code changes require verification. CI also runs the same test suite against PostgreSQL, audit, and manifest checks. For local PostgreSQL tests use `TEST_DATABASE_URL` pointing only to a disposable test database; the harness creates and drops isolated schemas.
4. For a local trial, run `npm run build` and `npm start`, open `http://127.0.0.1:3000`, and create the first account. Existing local databases may already contain an account: preserve them, or explicitly choose a separate `SQLITE_PATH`. Never delete a database just to reach the setup screen.
5. Ask for the user's manual acceptance findings, then fix concrete defects and record actual evidence. Do not claim real LLM, OIDC, SMTP, audible playback, native Office, or PowerPoint validation from mocks or API tests.
6. Update this handoff, status, and manual QA evidence before stopping. Record the exact commit/checks and any unfinished work; commit and push the authorized changes to the organization repository.

## Remaining work, in order

1. **User acceptance:** the user tests the first version over time. Compare the workflows they use with SessionLab, using `product-parity.md`; fix confirmed gaps and ergonomic issues. There is no user acceptance sign-off yet. Acceptance round 1 findings are fixed (see above); further annotated screenshots from the user are expected.
2. **Environment checks:** connect the real internal LLM service when provided; validate configured OIDC/SMTP if used; test Office exports, audible alerts, and the floating timer above native PowerPoint on the intended workstation. Browser Document Picture-in-Picture cannot guarantee every OS/full-screen mode; a native companion is a possible future decision, not an existing feature.
3. **After explicit acceptance:** add a small maintained nominal E2E suite covering the workflows used most often (roughly 80% of usage): account/sign-in, agenda editing and saving, private/public sharing, and timer delivery, with FR/EN coverage where valuable. Include privacy and persistence assertions; avoid an expensive exhaustive suite.
4. Configure repository rules/required checks and narrowly scoped dependency auto-merge only after the E2E gate works. Dependabot is already configured; do not enable unconditional merging.
5. Prepare the first release and Docker Hub credentials/settings with the user. Follow the existing publication workflow and deployment guides. Publish only the tested revision and retain its image digest, SBOM, and manifests.
6. The operator installs/upgrades OpenShift development, validates, then production. Validate first installation, secret preservation, database backup/restore, and upgrade/rollback. No cluster action is part of this handoff.

## Tooling and local caveats

- Claude Code cloud containers may ship an older Node.js. The continuation downloaded the official Node.js 24 archive into a user-local directory and prepended it to `PATH` for commands, without changing the system installation. A disposable PostgreSQL cluster outside the repository served `TEST_DATABASE_URL`.
- Gstack is installed in the original Windows environment under `~/.codex/skills/gstack-*`; ignored source lives in `.tools/gstack`. See [gstack.md](gstack.md). Another agent may need to install its own tooling; do not commit local tool installations.
- The original workspace is `D:\dev\repos\github\MeetLoom`. Local `.tools/` evidence and databases are ignored and are not necessary to clone/run the project. Never document credentials or commit local data.
- Windows shell execution may need sandbox approval for Node tests and Git writes. Use the available Node 24 runtime rather than changing the user's global installation. Keep TLS verification enabled; corporate proxy/CA settings are local operator concerns.
- The original local Docker engine could not reach its registry; the GitHub runner successfully built and checked the actual Dockerfile. Do not alter global DNS/proxy/TLS settings to work around that local issue.
- Previously started local preview servers are not a durable deliverable. Inspect current processes before restarting them, and stop only task-owned processes when necessary.
