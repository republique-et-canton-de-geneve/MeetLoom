# MeetLoom

Free, self-hosted software for planning and facilitating meetings and workshops.

## Resuming work

When the user says **"continue"** (or asks to resume), read `docs/handoff.md` and `docs/status.md` before acting. The handoff is the durable project context: user requirements, decisions, completed checkpoint, validation evidence, environment limits, and ordered remaining work. Also inspect the current branch, working tree, and PR checks; preserve changes made since the handoff was written. A generic continuation is not authorization to skip the user-acceptance, E2E, release, and deployment gates recorded there. Do not ask the user to repeat information already documented.

Before every pause or handoff, update `docs/handoff.md` with what is complete, what remains, relevant commits/checks, and a concrete next action. Record verification honestly; distinguish implemented, tested, and user-accepted behavior. Keep credentials and local private data out of this record. `CLAUDE.md` points to these same instructions, so maintain one shared source of truth.

## Working agreements

- Start with `docs/handoff.md` when resuming. Update it at every stopping point with the completed checkpoint, validation evidence, known limits, and ordered remaining work so another agent can continue without conversation history.
- Keep repository documentation, contributor instructions, and engineering guides in **English**, following RetroGemini's convention. The application supports both French and English. Preserve exact UI labels when recording evidence from a test performed in French.
- Read `ARCHITECTURE.md`, `docs/implementation-plan.md`, `docs/product-parity.md`, and `docs/engineering-reference.md`. Test evidence belongs in `docs/manual-qa.md`; do not mark a capability verified without corresponding evidence.
- Gstack is the requested tooling: native Codex installation under `~/.codex/skills/gstack-*`, with its ignored local source in `.tools/gstack`. Apply its product, engineering, and code reviews where relevant.
- Explicit user instructions take precedence over skill suggestions. Proceed without routine confirmations and document reversible decisions.
- Never expose an internal column through a public API, public export, public window, or log.
- Provide French and English translations for every application label.
- Run `npm run check` before delivery. Do not introduce a maintained end-to-end suite before the user validates the first version. Do not enable dependency auto-merge before a real E2E gate exists.
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
- Do not publish a release, merge, or install on a cloud service or cluster during implementation and manual acceptance preparation. The agreed sequence is functional coverage and manual testing, user acceptance, a maintained nominal E2E suite, then release and operator-led deployment.
- CI covers SQLite/PostgreSQL, compilation, formatting, dependency auditing, and manifests. Security workflows use CodeQL and Trivy. Docker Hub images are built and verified before publication, including arbitrary UID and read-only root filesystem checks. Never give GitHub OpenShift credentials.
- Keep manifests and guides generic. Organization-specific values belong in operator configuration. Preserve secrets and volumes during upgrades; code changes must never deploy as a side effect.
