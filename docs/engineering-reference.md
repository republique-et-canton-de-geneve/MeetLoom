# Engineering reference: RetroGemini

Audit performed on September 23, 2026 against the public [RetroGemini](https://github.com/republique-et-canton-de-geneve/RetroGemini) repository, branch `main`, commit **`eea60c4061703104fe5277e040f80c991c034b4e`**. The reference checkout is in `.tools/references/RetroGemini`; it is for reference only and must not be bundled with MeetLoom. Findings below describe files at that commit, not a certification of the deployed service or its GitHub settings.

## Recommendation for MeetLoom

MeetLoom's chosen operational workflow is **GitHub Release → Docker Hub → manual OpenShift update**. Manifests live in `k8s`, with `development` and `production` overlays that impose no namespace. Scripts accept the operator's chosen namespace. Objects, secrets, and volumes belong to MeetLoom. GitHub receives no cluster access. The [installation guide](deployment.md) is the reference for commands and settings actually delivered.

Keep RetroGemini's technical family: **React + TypeScript + Vite for the frontend, a Node/Express server, and PostgreSQL for production**. One image serves the API and static resources on configurable port 3000. This simplifies OpenShift operations, avoids a separate frontend service, and keeps authentication and updates on the same origin.

Start with a fresh agenda domain model. RetroGemini's practices transfer well; its retrospective data structures, team authentication, and whole-document merging are not components to copy without adaptation. Agenda editing needs scoped operations, server authorization, and revisions to detect conflicts. Private notes must be absent from visitor responses and events, not merely hidden in the browser.

PostgreSQL is the reference production mode. SQLite supports local trials under the same persistence contracts. Storage uses explicit additive migrations. Start with one application pod until multi-pod concurrency and propagation are proven. Document this limit before claiming multi-pod support.

## What RetroGemini actually implements

| Area         | Observation in source                                                                                 | Application to MeetLoom                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend     | React/TypeScript, Vite, Tailwind, functional components, local resources                              | Same stack family, English/French from the outset, no runtime CDN required                                                                      |
| Server       | Express, routes separated from services, services injected into routes                                | Typed shared contracts, `server/app.ts` assembly, and dedicated account, sharing, content, history, workspace, and AI modules                   |
| Persistence  | PostgreSQL or SQLite, JSON document storage, revision checks, and atomic writes                       | Transactions and revisions; validate permitted fields and detect concurrent document changes                                                    |
| Real time    | Socket.IO, PostgreSQL/Redis adapters, presence, reconnection, and acknowledgments                     | Current implementation uses polling with authorization on each request and separate public projections; no claim of multi-pod Socket.IO support |
| Operations   | `/health` and `/ready` probes, SIGTERM shutdown, correlated JSON logs, cache budgets                  | Separate liveness/readiness at `/api/health` and `/api/ready`, graceful shutdown, bounded resources, no private content in logs                 |
| AI           | Server service compatible with `/chat/completions`, configurable endpoint/model/key, optional feature | Configurable OpenAI-compatible LLM provider, no direct browser-to-LLM call                                                                      |
| Distribution | Multi-stage Docker image, Compose, Kubernetes/OpenShift Kustomize                                     | One self-contained image; configuration, secrets, and data outside the image                                                                    |

Sources: [package.json](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/package.json), [server.js](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/server.js), [dataStore.js](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/server/services/dataStore.js), [socketAdapter.js](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/server/services/socketAdapter.js), [shutdown.js](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/server/services/shutdown.js).

## CI and dependency maintenance

RetroGemini's `ci.yml` installs from the lockfile with `npm ci`, runs ESLint, TypeScript, tests and coverage, then builds production. It includes a Node matrix, npm audit, and a separate whole-code coverage check. Its final **CI Success** job depends on all others and uses `if: always()`: a canceled or skipped job does not silently become success. This stable check name lets the matrix change without repeatedly updating branch protections. Ordinary workflows declare `contents: read`, and actions are pinned to a SHA with a version comment.

The overall moderate-level npm audit is informational (`continue-on-error: true`), while high/critical production vulnerabilities block. CodeQL analyzes JavaScript/TypeScript on PRs and periodically. Trivy builds the image, produces SARIF, and blocks on fixable high/critical vulnerabilities. Distinguish these policies: a passing scan does not mean no vulnerabilities exist.

Dependabot checks npm daily, actions weekly, and groups related updates. The Vitest group includes major versions to keep the core and coverage modules aligned. The CodeQL group avoids mixing action versions from the same family. These patterns are useful; RetroGemini-specific reviewers, versions, and exceptions are not.

Automatic merging calls `gh pr merge --auto --squash` for bot PRs without major-version changes. **That workflow does not itself verify E2E success: it relies on required checks and protections configured in GitHub.** Repository settings must therefore be part of CI setup documentation. The comment “security updates only” in `dependabot.yml` does not make the configuration exclusive to security fixes: it also configures version updates and labels all npm PRs `security`.

MeetLoom follows two stages as requested:

1. **Before V1 acceptance**: formatting, type checks, targeted domain/authorization tests, API/persistence integration, builds, and scans; Dependabot opens PRs. Automatic merging remains disabled. UI journeys are checked manually, without prematurely maintaining an E2E suite.
2. **After V1 acceptance**: build a small Playwright suite for stable workflows, make it required in branch protections, and then enable automatic merging of patch/minor updates. Major changes remain reviewed. Never describe automatic merging as E2E-protected before the check actually exists and is required.

Sources: [ci.yml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/.github/workflows/ci.yml), [dependabot.yml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/.github/dependabot.yml), [dependabot-auto-merge.yml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/.github/workflows/dependabot-auto-merge.yml), [codeql.yml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/.github/workflows/codeql.yml), [docker-security.yml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/.github/workflows/docker-security.yml).

### Test strategy to adopt

RetroGemini has domain, server, authorization, concurrency, accessibility, and deployment tests. Two-client convergence and revision tests are particularly relevant: checking only a final state does not detect perpetual oscillation between browsers. For MeetLoom, prioritize schedule invariants, public projection privacy, link revocation, timer transitions, and prevention of concurrent-edit loss.

RetroGemini E2E tests retain traces, screenshots, and videos and include another run against production files served by Express. This exercises actual CSP headers; Vite-only testing can pass while production fails to load. Adopt that principle after MeetLoom's interface is accepted, with a few valuable journeys: agenda creation/editing, filtered public sharing, timed facilitation, English/French, and sign-out/sign-in.

Sources: [e2e.yml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/.github/workflows/e2e.yml), [playwright.prod.config.ts](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/playwright.prod.config.ts), [twoBrowserSessionConvergence.test.ts](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/__tests__/twoBrowserSessionConvergence.test.ts).

## OpenShift practices and quick deployment

RetroGemini uses a Kustomize base and OpenShift overlay. The overlay adds a TLS Route with HTTPS redirection, switches PostgreSQL to the Red Hat image intended for OpenShift, and removes fixed UIDs/GIDs from the base. This avoids pod rejection by security constraints that assign a UID from the project's range.

Pods declare `runAsNonRoot`, `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false`, all capabilities dropped, and `automountServiceAccountToken: false`. The application has no reason to receive a Kubernetes API access token. RetroGemini's application deployment configures two replicas, rolling updates without intended downtime, resources, probes, and a PDB. Secrets are separate from Kustomization: reapplying manifests does not accidentally replace the PostgreSQL password or session secret.

Its guide highlights two concrete issues: editing a PostgreSQL Secret alone does not change the password stored in an initialized database; standard PostgreSQL's `PGDATA` should be a subdirectory of the volume to avoid `lost+found` and incompatible permissions. The Red Hat image has its own mount and variable names, so the overlay removes inherited `PGDATA`.

RetroGemini's guide requires several commands. MeetLoom provides an **idempotent installer** that:

1. checks `oc`, authentication, the target project, and required parameters;
2. creates only missing secrets with strong random values, without logging them;
3. creates the Route to determine the canonical HTTPS origin and preserves existing environment configuration;
4. renders the selected overlay with the exact image reference and applies PostgreSQL/PVC, Service, application, and Route;
5. waits for the database and application deployments;
6. checks `/api/ready` and prints the URL and a private bootstrap-token retrieval command.

The installer accepts existing external PostgreSQL. A bundled single-replica database is a simple installation, not a high-availability promise; backups and restoration are documented separately. Secrets and environment-specific configuration must survive updates. Rerunning the installer neither regenerates credentials nor resets data. The application runs two pods with a rolling update (`maxUnavailable: 0`), a `preStop` pause and a PodDisruptionBudget, so updates cause no interruption; the bundled PostgreSQL stays one pod with `Recreate`. Pods starting together serialize schema creation with a PostgreSQL advisory lock. Schema changes must stay additive (old and new pods run side by side during an update).

A new application image can start directly as an unprivileged user, with group permissions compatible with an arbitrary UID and explicit mounts for writable paths. This avoids copying RetroGemini's Docker entrypoint, which starts as root to repair `/data` permissions before dropping privileges. On OpenShift, that entrypoint also supports being launched directly under an arbitrary UID.

RetroGemini's NetworkPolicies are intentionally optional: an existing permissive rule in the namespace can make their restrictions ineffective. The guide must describe actual connectivity checks and the relationship to platform rules. Do not add a namespace-wide default deny without knowing other applications and DNS/LLM/SMTP requirements.

Sources: [k8s guide](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/k8s/README.md), [deployment.yaml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/k8s/base/deployment.yaml), [OpenShift overlay](https://github.com/republique-et-canton-de-geneve/RetroGemini/tree/eea60c4061703104fe5277e040f80c991c034b4e/k8s/overlays/openshift), [Dockerfile](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/Dockerfile), [networkpolicy.yaml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/k8s/base/networkpolicy.yaml).

## Privacy and LLM integration

RetroGemini serves resources locally and applies a CSP, without a mandatory external runtime service. AI remains disabled until configured; the server constructs requests to an OpenAI-compatible endpoint. AI routes are authenticated and public errors do not disclose internal addresses or detailed provider responses.

MeetLoom follows this model with `LLM_BASE_URL`, `LLM_MODEL`, an optional API-key secret, timeout, and response-size limits. The operator configures the actual model and its identifier. Supply an internal CA through Node's TLS configuration; do not default to RetroGemini's option for disabling certificate verification.

Agenda generation produces a schema-validated structured proposal for review before insertion and preserves the existing version on error. Agenda contents are data sent to the model, not instructions authorizing permission changes. Provider configuration and credentials belong to server administration. All essential operations remain usable without AI.

Visitor links use server projections that exclude private cells, presenter prompts, and administrative data. Public HTTP responses, exports, and presentation views must use these projections. Revocable random tokens, a read-only agenda scope, validation on every access, and `Cache-Control: no-store` on sensitive responses are useful foundations. Explicitly enabled public discussions and forms are separately scoped; they do not grant agenda-editing rights or expose internal comments. A visitor must never receive a private field, even when inspecting network responses.

Sources: [aiService.js](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/server/services/aiService.js), [aiRoutes.js](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/server/routes/aiRoutes.js), [securityHeaders.js](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/server/services/securityHeaders.js).

## Publication and practices to improve rather than copy

RetroGemini publishes images through a dedicated workflow and attaches a CycloneDX production-dependency SBOM to releases. This helps isolated organizations identify installed software without querying npm. The final image excludes development dependencies. Also provide a manifest archive, upgrade/rollback guide, and backup policy.

Several observable source limitations deserve adaptation:

- CodeQL analysis and SARIF upload may continue on error. MeetLoom must distinguish successful analysis from unavailable upload; a missing check must not look like a clean scan.
- Docker publication is a manual workflow that can be triggered by the release workflow; no `needs` dependency ties it to `ci.yml` tests. MeetLoom's pipeline must publish the verified commit and expose its revision/digest, rather than publishing a different `main` that moved in the meantime.
- A Deployment comment claiming that a workflow automatically rewrites the tag is stale: `docker-deploy.yml` documents removal of that step. Keep a single version source and check image/manifest/documentation consistency rather than copying those comments.
- Base and PostgreSQL images use mutable tags. For reproducible internal releases, retain digests and have reviewed automation propose updates.
- Application snapshots in the same database support functional restoration but do not replace an external backup against volume loss.

Sources: [docker-deploy.yml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/.github/workflows/docker-deploy.yml), [github-release.yml](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/.github/workflows/github-release.yml), [deploymentManifestParity.test.ts](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/__tests__/deploymentManifestParity.test.ts), [backupService.js](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/server/services/backupService.js).

## Mapping of delivered practices

| Practice observed in RetroGemini         | MeetLoom adaptation                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CI, type checks, tests, build, artifacts | `ci.yml`, Node 24, SQLite/PostgreSQL contracts, retained build, and aggregated `CI Success`              |
| Scheduled and PR CodeQL                  | `security.yml`, security/quality suite, visible rather than hidden failure                               |
| Image and dependency scans               | Blocking production npm audit, blocking Trivy, arbitrary-UID/read-only-root smoke test                   |
| npm/actions/Docker Dependabot            | Related React, Tiptap, and CodeQL groups; no assignment to a personal account                            |
| Automatic merging after E2E              | Patch and development minor Dependabot updates, once the required **CI Success** check (with E2E) passes |
| GitHub Release and Docker Hub            | One workflow checks the same commit, then publishes version, SHA, digest, SBOM, and installation archive |
| `k8s`, overlays, separate secrets        | Generic environments, secrets created once, guard against lost credentials for an existing PVC           |
| Render button and Blueprint              | Repository build and documented ephemeral free plan; first account protected by a generated token        |
| README, security, operations             | Contribution, deployment, backup, upgrade, and rollback guides                                           |

The [RetroGemini Blueprint](https://github.com/republique-et-canton-de-geneve/RetroGemini/blob/eea60c4061703104fe5277e040f80c991c034b4e/render.yaml) uses a prepublished image. MeetLoom builds the repository's Dockerfile so forks also work without depending on a particular Docker Hub account. See the [Render guide](render.md) for free-service details and limitations. RetroGemini's TypeScript 7 compatibility checks and Node version matrix are not adopted while MeetLoom explicitly targets Node 24.

## Validation scope of this audit

The cited configuration, CI, deployment, and service files were read. This reference audit did not deploy OpenShift, run RetroGemini's remote CI, or examine its effective repository protections. MeetLoom's architectural choices come from that reading; its own verification evidence and environmental limits are tracked in [status](status.md) and [manual QA](manual-qa.md). Defined workflows are not proof of successful remote execution. The requested Gstack usage belongs to MeetLoom's setup and workflow; the reference repository's Gstack instructions describe its own use and do not replace this project's instructions.
