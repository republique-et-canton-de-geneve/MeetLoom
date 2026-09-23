# Agent handoff

Last updated: September 23, 2026. Read this file first when continuing in Codex, Claude, or another coding agent. Update it at every stopping point; do not rely on conversation history.

## Current stopping point

A Claude Code continuation on September 23, 2026 verified the Codex checkpoint and added three small corrections. They are on branch `claude/epic-pascal-3gk99i`, which starts from `codex/meetloom-v1` and has its own pull request targeting `codex/meetloom-v1`, so PR #1 receives them only when that pull request is merged. No code modification remains in progress. Resume with user acceptance and the ordered work below; do not start another feature, release, or deployment merely to finish this checkpoint.

- **Rate-limiter lifecycle:** `createApp().close()` now shuts down every in-memory limiter store created while that application was assembled (`withRateLimitStores` in `server/security.ts`, based on `AsyncLocalStorage`). A failed assembly releases the stores it created. Three tests cover per-application isolation with concurrent assemblies, the failure path, and a complete application closure. This resolves the former low-priority embedding caveat.
- **Dashboard sidebar:** the workspace selector and “Créer un espace” were flush against the sidebar's left edge. They now align with the workspace card at every breakpoint (18 px, 10 px at 900 px and below; the mobile layout is unchanged).
- **Document language:** `<html lang>` was only updated when the language switch was clicked, so reloading with English stored kept `lang="fr"`. The provider now synchronizes it from the first render.

Local verification of this continuation: `npm run check` passed with 228 tests, both TypeScript projects, and the production build; the same 228 tests passed on a disposable PostgreSQL 16 database; `npm run format:check` and the infrastructure Prettier check passed; the production dependency audit reported zero vulnerabilities. Browser evidence is in [manual-qa.md](manual-qa.md). The repository's CI and Security workflows run on pushes to `main`/`codex/**` and on pull requests targeting `main`, **not** on a pull request targeting `codex/meetloom-v1`: hosted checks for these commits start only once they reach `codex/meetloom-v1` (and therefore PR #1). Inspect those checks, including the separate CodeQL findings check, after that merge.

The preceding Codex checkpoint remains valid: **validated code commit** `10b4f1a28e0b0d27429f0c541675263d2f9ea1e8` passed [CI 35885304817](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35885304817) (SQLite/PostgreSQL, types, build, formatting, audit, manifests) and [Security 35885304655](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35885304655) (exact image build, arbitrary-UID/read-only-root smoke test, Trivy, CodeQL), plus the separate CodeQL findings check `107264308348`. Its documentation-only follow-up `38d24c0` also passed every check on PR #1.

The implementation is in [MeetLoom PR #1](https://github.com/republique-et-canton-de-geneve/MeetLoom/pull/1), on `codex/meetloom-v1`. The PR remains a draft for manual acceptance. The default branch still contains the original repository initialization until the PR is merged. Check out the implementation branch to run the app; README badges and the Render button on the default branch cannot represent this unmerged version yet.

`origin` is `https://github.com/republique-et-canton-de-geneve/MeetLoom.git`. The former personal remote is named `personal`; the user will archive that repository. Both initial Git histories were preserved with a normal merge. Never force-push or recreate the repository to simplify its history.

## Requirements and decisions to preserve

- Build an independent, free, self-hosted SessionLab functional counterpart. Use an original visual identity, not a copy of SessionLab colors or design. SessionPlan is an ergonomics reference; none of its AGPL code was imported.
- The application must support French **and** English. Repository documentation, README, guides, and agent instructions must be **English**, following RetroGemini. Speak French to the user unless asked otherwise.
- Explicit exclusions: Parking lot, block/session library, and attachments in blocks. Temporary document import and images in Forms are separate implemented features.
- Protect internal columns and presenter notes through server-side projections. Anonymous links must not receive hidden content, even in exports or network responses.
- Keep configurable advance sound warnings (minutes or percentage), the shared timer, keyboard-friendly agenda editing, and the floating presentation window. Native PowerPoint overlay behavior is environment-dependent.
- Qwen integration is optional and server-side. The organization's actual endpoint/model identifier has not been supplied. Never add a public provider fallback or send private data without the selected scope.
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

1. Run `git status --short`, `git branch --show-current`, and `git remote -v`. Preserve any user changes. Fetch `origin` and inspect PR #1's current head and checks, and whether the `claude/epic-pascal-3gk99i` pull request has been merged into `codex/meetloom-v1`, before assuming this record is current.
2. Read `AGENTS.md`, this file, `docs/status.md`, and the relevant parity/manual-QA sections. Current work is acceptance preparation, not a blank-slate implementation.
3. With Node.js 24, run `npm ci`, `npm run check`, and `npm run format:check` when code changes require verification. CI also runs the same test suite against PostgreSQL, audit, and manifest checks. For local PostgreSQL tests use `TEST_DATABASE_URL` pointing only to a disposable test database; the harness creates and drops isolated schemas.
4. For a local trial, run `npm run build` and `npm start`, open `http://127.0.0.1:3000`, and create the first account. Existing local databases may already contain an account: preserve them, or explicitly choose a separate `SQLITE_PATH`. Never delete a database just to reach the setup screen.
5. Ask for the user's manual acceptance findings, then fix concrete defects and record actual evidence. Do not claim real Qwen, OIDC, SMTP, audible playback, native Office, or PowerPoint validation from mocks or API tests.
6. Update this handoff, status, and manual QA evidence before stopping. Record the exact commit/checks and any unfinished work; commit and push the authorized changes to the organization repository.

## Remaining work, in order

1. **User acceptance:** the user tests the first version over time. Compare the workflows they use with SessionLab, using `product-parity.md`; fix confirmed gaps and ergonomic issues. There is no user acceptance sign-off yet. Open wording question for the user: the dashboard sidebar shows the caption “ESPACE DE TRAVAIL / WORKSPACE” twice (above the workspace selector and above the navigation list); pick a distinct caption for the navigation list or remove one.
2. **Environment checks:** connect the real internal Qwen service when provided; validate configured OIDC/SMTP if used; test Office exports, audible alerts, and the floating timer above native PowerPoint on the intended workstation. Browser Document Picture-in-Picture cannot guarantee every OS/full-screen mode; a native companion is a possible future decision, not an existing feature.
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
