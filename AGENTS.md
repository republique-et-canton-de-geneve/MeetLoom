# MeetLoom

Free, self-hosted software for planning and facilitating meetings and workshops.

## Resuming work

When the user says **"continue"** (or asks to resume), read `docs/handoff.md` and `docs/status.md` before acting. The handoff is the durable project context: user requirements, decisions, completed checkpoint, validation evidence, environment limits, and ordered remaining work. Also inspect the current branch, working tree, and PR checks; preserve changes made since the handoff was written. A generic continuation is not authorization to skip the user-acceptance, E2E, release, and deployment gates recorded there. Do not ask the user to repeat information already documented.

Before every pause or handoff, update `docs/handoff.md` with what is complete, what remains, relevant commits/checks, and a concrete next action. Record verification honestly; distinguish implemented, tested, and user-accepted behavior. Keep credentials and local private data out of this record. `CLAUDE.md` points to these same instructions, so maintain one shared source of truth.

## Working agreements

- Start with `docs/handoff.md` when resuming. Update it at every stopping point with the completed checkpoint, validation evidence, known limits, and ordered remaining work so another agent can continue without conversation history.
- Keep repository documentation, contributor instructions, and engineering guides in **English**, following RetroGemini's convention. The application supports both French and English. Preserve exact UI labels when recording evidence from a test performed in French.
- Read `ARCHITECTURE.md`, `docs/implementation-plan.md`, `docs/product-parity.md`, and `docs/engineering-reference.md`. Test evidence belongs in `docs/manual-qa.md`; do not mark a capability verified without corresponding evidence.
- Gstack is the required tooling; see **AI tooling: gstack** below.
- Explicit user instructions take precedence over skill suggestions. Proceed without routine confirmations and document reversible decisions.
- Never expose an internal column through a public API, public export, public window, or log.
- Provide French and English translations for every application label.
- Run `npm run check` before delivery, and `npm run test:e2e` when a user journey changes. Keep the E2E suite small and nominal. Dependency auto-merge relies on the required **CI Success** check on `main`.
- Keep secrets and local data out of Git. Do not copy AGPL SessionPlan code into this Unlicense repository.
- Prefer simple components, shared functions, and native APIs before adding dependencies.

## Contracts to preserve

- `server/app.ts` assembles modules and centralizes session authorization and compare-and-swap writes. Keep history, mentions, folders, and closed-session checks in the same transaction as the save. Transfers between sessions must be atomic.
- `Session.workspaceId` and `Session.lifecycle` are authoritative server metadata backed by dedicated tables. The persisted JSON document and user patches are not their source of truth. Permissions combine ownership, individual access, and workspace membership.
- Deleted sessions are inaccessible to collaborators and public links. Closed sessions remain readable, but agendas, timers, comments, and form responses cannot be changed. Related writes must lock the session and check its lifecycle within the transaction.
- Visitor projections use explicit allowlists of permitted fields and content. Public exports, form links, responses, mentions, and MCP tools must preserve these boundaries. Rich text is validated JSON rendered through safe components, never arbitrary HTML.
- AI, OIDC, and SMTP are optional server-side integrations. Do not add an external fallback provider or accept arbitrary provider URLs from the browser. Imported files have bounded size and temporary processing; do not introduce attachment storage.
- SQLite and PostgreSQL share the same contracts. Additive tables are initialized idempotently; changes to existing types or formats require a migration and a test. Use parameterized SQL, revision checks, and consistent lock ordering.

## Validation and delivery

- Use Node.js 24, `npm ci`, and `npm run check`, then format changed files. Also test persistence changes with `TEST_DATABASE_URL`: tests create isolated schemas in a test database and remove them afterward.
- Check visual flows in a real browser in French and English, including empty, loading, error, and permission states. Lazy loading uses Suspense boundaries; do not artificially raise bundle limits to hide warnings.
- SPA navigation goes through `src/navigation.ts`. Editor guards save both agendas before unmounting, including on `popstate`, and preserve drafts when a save is rejected. Keep domain helpers imported by tests independent of CSS imports.
- Do not publish a release, merge to `main`, or install on a cloud service or cluster unless the user asks. Releases and OpenShift deployments are operator-led.
- CI covers lint, dead code, SQLite/PostgreSQL, compilation, formatting, dependency auditing, manifests, shell scripts and the E2E journeys. Security workflows use CodeQL and Trivy. Docker Hub images are built and verified before publication, including arbitrary UID and read-only root filesystem checks. Never give GitHub OpenShift credentials.
- Keep manifests and guides generic. Organization-specific values belong in operator configuration. Preserve secrets and volumes during upgrades; code changes must never deploy as a side effect.

## AI tooling: gstack

This repository standardizes on [gstack](https://github.com/garrytan/gstack), as RetroGemini does. **On Claude Code, every prompt starts by choosing a gstack command**; nobody should have to write "use gstack". State the chosen command in one line before running it:

| The prompt is about…                              | Command                                                      |
| ------------------------------------------------- | ------------------------------------------------------------ |
| a reported bug, "why does X happen"               | `/investigate`                                               |
| a change that is written and about to land        | `/review`                                                    |
| security: an audit, a finding, a threat question  | `/cso`                                                       |
| "what state is the code in", a quality baseline   | `/health`                                                    |
| exercising the running app and fixing what breaks | `/qa` (`/qa-only` to report only)                            |
| vague intent that needs pinning down              | `/spec`; a plan needing a second opinion: `/plan-eng-review` |
| performance or load                               | `/benchmark`, plus `loadtest/run.mjs` for the server         |
| docs to refresh after a change                    | `/document-release`                                          |

When none fits (a pure question, a one-line edit), say `no gstack command fits: <reason>` and proceed. Answering as if gstack did not exist is not acceptable. gstack suggestions never override this file: tests first, the handoff, and the rules below still apply. Its release steps (`/ship`, `/land-and-deploy`) do not replace the release process in `docs/deployment.md`.

**Enforcement.** Three committed hooks in `.claude/settings.json`: `session-start.sh` installs npm dependencies (`npm ci --ignore-scripts`), sets `PW_CHROMIUM_PATH` and installs gstack in Claude Code on the web containers; `gstack-route.sh` injects the routing table on every prompt; `check-gstack.sh` blocks skills when gstack is missing. Never commit `check-gstack.sh` without `session-start.sh`: the guard alone would block every web session, whose containers start without gstack.

**Manual install (local machine, once):** `git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup --team`. Codex uses its own installation (`setup --host codex`, see [docs/gstack.md](docs/gstack.md)); other assistants cannot run the commands, and for them the table describes what a thorough answer covers.

## Health Stack

Commands used by `/health` and before every delivery:

- typecheck: `npm run typecheck`
- lint: `npm run lint` (ESLint; errors fail; the warning budget in `scripts/lint.mjs` may only go down)
- test: `npm test` (and with `TEST_DATABASE_URL` for PostgreSQL)
- deadcode: `npm run deadcode` (knip)
- shell: `shellcheck scripts/*.sh .claude/hooks/*.sh`

## Production rules

MeetLoom runs in production on OpenShift with **two application pods** and rolling updates. Every change must keep that working:

- **Shared state lives in PostgreSQL.** Presence, mail leases, timers and sessions are in the database; nothing may rely on one process's memory except per-pod rate-limit counters. A second pod must see the same data immediately.
- **Schema changes are additive.** Old and new pods run side by side during an update: add tables or columns with `CREATE ... IF NOT EXISTS`, never rename or drop what the previous version reads. Startup schema creation runs under a PostgreSQL advisory lock released at the end of `createApp`; module tables are created during assembly like the others.
- **Clients reconnect by polling.** Editors and visitors poll every three seconds; a request lost during a pod restart is retried by the next poll. Keep writes idempotent or version-checked.
- **Offline and air-gapped.** Never load fonts, scripts, styles, images or APIs from external URLs; bundle them. The Content Security Policy allows only `'self'` (and `data:` for images and fonts) and is pinned by `tests/security-headers.test.ts`; the E2E suite serves the production build through the same server, so a policy that breaks the app fails there. Do not weaken it to make something load.
- **Public links are bounded.** Anonymous writes (form responses, visitor comments) have per-address rate limits and storage quotas in `server/quotas.ts`; a new public write needs both. Request budgets: a per-address flood guard sized for a meeting room behind one NAT, and a per-account budget for signed-in users.
- **Privileged actions are audited.** Every administrator action writes an `audit_events` row through `audit()` in the same transaction (`server/audit.ts`). A new privileged route adds its action name to `AUDIT_ACTIONS`; `tests/audit.test.ts` fails if a declared action has no emitter. Never record secrets (tokens, passwords).
- **Configuration parity.** When adding or changing an environment variable, update in the same change: `.env.example`, `server/config.ts`, `README.md`, `k8s/base/application.yaml` or the ConfigMap/Secret documentation in `docs/deployment.md`, the installers when they create it, and `compose.yaml`.
- **Keep the repository generic.** It is public and used by anyone: never write an organization's internal hostnames, registries, URLs, namespaces or people.

## Development workflow

- **Tests first.** For a bug, write a test that fails, then fix it. For a feature, write the expected behavior as a failing test. Every change leaves at least one committed test that would fail without it; pick the cheapest level (domain or API test before E2E).
- **Before committing:** `npm run lint`, `npm run deadcode`, `npm run check`, `npm run format:check`; `TEST_DATABASE_URL=… npm test` when persistence changes; `npm run test:e2e` when a user journey changes; `node loadtest/run.mjs` against a disposable database when a polled endpoint, the rate limits or the database access pattern changes.
- **Report per change:** the new tests, the existing tests that already cover the area, and a short manual-verification list limited to what tests cannot cover.
- **Commit messages** start with a short imperative summary; prefixes such as `fix:`, `feat:`, `security:`, `docs:`, `test:`, `refactor:`, `deps:` are welcome. Explain why in the body.
- **Changelog.** User-visible changes add one line under `## [Unreleased]` in `CHANGELOG.md`; internal changes (refactors, tests, CI, dependency updates) do not. The release moves the section under the new version.
- **After opening a pull request,** watch every check (CI Success, Security, CodeQL, Trivy) until green; address or explicitly answer every review and bot finding.
