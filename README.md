# MeetLoom

Plan and facilitate sessions with a shared agenda and notes that stay private. A free, self-hosted application in English and French.

> **Developed with AI.** MeetLoom's code, tests and documentation were written by AI coding agents (OpenAI Codex, then Anthropic Claude Code), directed, reviewed and accepted by a human maintainer. Every change goes through automated tests, end-to-end journeys and security scans before it reaches `main`. Review it like any other open-source project before deploying it, and report issues through [SECURITY.md](SECURITY.md) or GitHub issues.

**Version 0.1 is undergoing functional review.** Implemented features are listed below; the [parity matrix](docs/product-parity.md) and [manual QA evidence](docs/manual-qa.md) track their verification. User acceptance comes before maintained end-to-end tests, the first release, and deployment.

[![CI](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/workflows/ci.yml/badge.svg)](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/workflows/ci.yml)
[![Security](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/workflows/security.yml/badge.svg)](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/workflows/security.yml)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/republique-et-canton-de-geneve/MeetLoom)

The Render button sets up a demo on the free plan **with ephemeral data**: data may disappear when the service restarts or spins down. See the [Render guide](docs/render.md) to create the first account and choose durable storage. Use your own hosting for internal agendas.

## Run locally

Continuing development with another coding agent? Start with the [agent handoff](docs/handoff.md) and [working agreements](AGENTS.md).

Requirements: **Node.js 24 LTS** and npm. SQLite is built into Node, so no database server is needed for a local trial.

```bash
npm ci
npm run build
npm start
```

Open [MeetLoom locally](http://127.0.0.1:3000), create the first account, then choose **Explore an example**. No demo account or password is preinstalled. Data is stored in `data/meetloom.sqlite`, which Git ignores.

Copy `.env.example` to `.env` to customize configuration. The server loads this file; variables supplied by the environment take precedence. Production requires `APP_ORIGIN` and a `BOOTSTRAP_TOKEN` for the first account. The installation screen asks for this token. Never expose an uninitialized development server to the Internet.

For development with code reloading, run these commands in two terminals:

```bash
npm run dev
npm run dev:client
```

Open [the Vite server](http://127.0.0.1:5173). If `APP_ORIGIN` is set during development, use that exact origin.

## Available features

- Card and list dashboards, search and sorting, unread activity and recently opened sessions, persistent folders and subfolders, duplication and archiving.
- Workspaces with administrators, editors, viewers, and guests limited to selected sessions; a logo and defaults for new sessions, columns, categories, pages, forms, sounds, and exports.
- Multi-day agendas; rich text, tasks and materials, categories, assignees, nested groups, notes, and parallel tracks. Move, duplicate, undo/redo, copy or transfer between sessions, and lock start times with overlap warnings.
- Reorderable, resizable columns, separate time/duration and description layouts, editor visibility, and **team** or **team & visitors** audiences. Presenter notes are private by default.
- Local accounts, profiles and preferences, administration, invitations, and session roles. Optional OIDC sign-in and SMTP recovery remain disabled until configured.
- Presence, merging of independent changes, explicit conflict resolution, threaded comments, and mentions. Named versions, a readable activity log, day restoration/copying, and recovery of deleted items for 72 hours.
- Pages and forms, responses, exports, and optional AI summaries. Publication links are revocable and response privacy is enforced on the server.
- Visitor links and simplified agendas without an account, with content restrictions, expiration, and revocation. The server removes private fields before sending data. Public pages refresh automatically.
- A shared timer: pause, resume, navigation, +1/+5 extensions, recovery of the previous block after automatic advancement, progress, and ahead/behind indicators against durations captured at the start.
- Advance warnings in minutes or as a percentage of remaining duration, an end sound, sound selection, and volume. Per-session settings and defaults for new sessions.
- A **Document Picture-in-Picture** window in compatible browsers, with a separate window as a fallback. The display includes the title and timing, without internal notes.
- Session closure, facilitator selection, and a filterable report; deleted sessions remain recoverable for 30 days in a trash area separate from archives.
- Optional internal AI: conversations, organization/workspace instructions, and proposals based on a selected context, with review before applying changes. It connects to any OpenAI-compatible LLM server (vLLM, Ollama, LiteLLM, Azure OpenAI, OpenAI…).
- JSON/CSV/Word/PowerPoint exports and printing/PDF; JSON import and DOCX/PPTX/XLSX/PDF/CSV extraction. Image OCR requires a configured internal vision model. Imported files are processed temporarily and do not become attachments.
- An [MCP server](docs/mcp.md) with personal tokens and account permissions for authorized clients.

The [user guide](docs/user-guide.md) describes these workflows. See also [workspaces, folders, history, and closure](docs/workspaces-and-lifecycle.md), [AI and imports](docs/ai-and-import.md), [collaboration](docs/collaboration.md), and [OIDC/SMTP](docs/services-auth-mail.md). The [scope and limitations](docs/status.md) distinguish implemented code, QA, and user acceptance.

## OpenShift, Kubernetes, and PostgreSQL

One image serves the frontend and API. The generic manifests in [k8s](k8s/README.md) provide an HTTPS Route, health probes, resource limits, stable secrets, PostgreSQL/PVC storage, and an arbitrary unprivileged user. The `development` and `production` overlays accept your chosen namespace.

After acceptance, the intended workflow is **GitHub Release → Docker Hub image → operator-managed OpenShift update**. The workflow and manifests are prepared; they have not been run on your cluster. The [procedure](docs/deployment.md) covers secrets, publication, and installation into an existing project:

```powershell
pwsh ./scripts/deploy-openshift.ps1 -Environment development -Project meetloom-dev -Image docker.io/your-account/meetloom:0.1.0
```

```bash
MEETLOOM_NAMESPACE=meetloom-dev bash scripts/deploy-openshift.sh development docker.io/your-account/meetloom:0.1.0
```

The scripts are idempotent, preserve the PVC and secrets, and check readiness. To update, change only the `app` container image in the `meetloom` Deployment. GitHub receives no cluster access. The [deployment guide](docs/deployment.md) covers installation, publication, upgrades, rollback, Kubernetes without OpenShift, external PostgreSQL, internal registries, the LLM connection, and Docker Compose. See also [operations and backups](docs/operations.md).

## Connect an LLM

AI assistance is optional and works with any server exposing the OpenAI-compatible Chat Completions API (`/v1/chat/completions`): an internal vLLM, Ollama, LiteLLM or TGI gateway, Azure OpenAI, OpenAI, Mistral, and similar. Configure these values on the server only:

```dotenv
LLM_BASE_URL=https://your-internal-llm.example/v1
LLM_MODEL=exact-model-identifier
LLM_API_KEY=if-required
```

Use the exact model identifier your server expects; nothing is tied to a particular model family. The server calls `/chat/completions`, validates the response, bounds its size and duration, and returns a preview. There is no default external endpoint, no key sent to the browser, and no agenda applied without user action. Internal columns enter the AI context only when explicitly selected. For OCR, add `LLM_VISION_MODEL` on the same internal provider. For an internal certificate authority, mount it through `NODE_EXTRA_CA_CERTS`; `LLM_ALLOW_SELF_SIGNED=true` instead skips certificate checks for the LLM only (see [deployment](docs/deployment.md#internal-certificate-authority)).

Without `LLM_BASE_URL`, the AI features (assistant, AI help, AI summaries and structuring) do not appear at all.

## Backups and moving data

Administrators find scheduled backups, restore points, session recovery and the encrypted export/import of all data under **Mon compte & équipe → Sauvegardes et données**. See [operations](docs/operations.md#back-up-and-restore); they complement, not replace, backups of the PostgreSQL volume.

## Engineering and verification

The [architecture, security and load review](docs/architecture-review.md) summarizes the controls, test evidence, capacity measurements and open recommendations. AI-assisted work uses [gstack](docs/gstack.md) as described in [AGENTS.md](AGENTS.md).

```bash
npm run lint        # ESLint (errors fail; the warning budget only goes down)
npm run deadcode    # knip
npm run check       # TypeScript, domain/API tests, and build
npm test
npm audit
npm run format:check
```

`TEST_DATABASE_URL` runs the same API contracts against PostgreSQL, using an isolated schema per test. CI runs lint, dead-code and shell checks, SQLite and PostgreSQL, renders manifests, and checks dependencies. `loadtest/run.mjs` measures capacity against a running server ([results](loadtest/README.md)). CodeQL and Trivy provide additional scans. GitHub Actions are pinned to commits. Docker Hub publication is triggered by a GitHub Release or manually and repeats checks, including PostgreSQL, before publishing. The Release retains the digest, commit, SBOM, and installation manifests.

**End-to-end journeys** (`npm run test:e2e`, Playwright) cover accounts, agenda editing, visitor privacy and facilitation in CI and before every release. Dependabot patch and development minor updates are auto-merged only once the required checks pass; the repository must require **CI Success** on `main`.

The [RetroGemini audit](docs/engineering-reference.md) explains adopted practices and differences. The [product research](docs/product-research.md) cites SessionLab/SessionPlan sources and explains the fresh implementation. Gstack was installed first and subsequently used for reviews; see [Gstack tooling](docs/gstack.md).

The [architecture](ARCHITECTURE.md) describes modules and trust boundaries. The [contribution guide](CONTRIBUTING.md) explains SQLite/PostgreSQL checks and schema changes.

## Privacy and limitations

Visitors cannot access team columns, internal comments, accounts, or versions. A public discussion may be enabled separately on a link without exposing internal conversations. All authorized session members, including viewers, can read its team columns. Anyone possessing a visitor link can access its scope until expiration or revocation. Revocation stops future reads; it cannot retract information already read or exported.

Saving uses version checks and merging by object identifier and field; conflicting edits to the same field require explicit resolution. Periodic refresh is not character-level CRDT editing. With PostgreSQL, several application pods can run side by side (the OpenShift manifests run two, for updates without interruption); SQLite is for a single instance. The timer runs a parallel block as one step lasting as long as its longest track. Actual deployment, your OIDC/SMTP provider, LLM endpoint, and the overlay above PowerPoint still need validation in your environment.

The explicitly excluded features remain absent: parking lot, block/session library, and attachments in blocks.

## License

[Unlicense](LICENSE). MeetLoom code is original. No SessionPlan AGPL code or SessionLab library content has been copied. Dependencies retain their respective licenses.
