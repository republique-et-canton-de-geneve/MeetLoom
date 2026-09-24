# Architecture, security and load review

Review of `main` after the 0.1.0 release (September 24, 2026), prepared for an architecture board. Method: gstack `/health` (quality baseline) and `/cso` (security audit through its trusted helper), a manual review of every server entry point, a new load test (`loadtest/run.mjs`), and a comparison with the practices of RetroGemini, the organization's reference project. Every finding below was fixed with a test that fails without the fix, unless it is listed as an accepted risk.

## System in one page

| Part          | Choice                                                                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client        | React 19 single-page application built by Vite, served by the same server; French and English; no external resource (CSP `'self'`).                                                                                                                  |
| Server        | Node.js 24, Express 5, TypeScript, zod validation at every boundary; about 47,000 lines across `server/`, `shared/`, `src/`; 27 production dependencies.                                                                                             |
| Data          | PostgreSQL in production (SQLite for local trials), parameterized SQL only, compare-and-swap versions on every agenda write, additive schema created at startup.                                                                                     |
| Collaboration | Clients poll every three seconds; presence heartbeats every ten seconds, stored in PostgreSQL; no WebSocket.                                                                                                                                         |
| Integrations  | Optional and server-side only: OpenAI-compatible LLM, OIDC sign-in, SMTP. No key or provider URL reaches the browser.                                                                                                                                |
| Runtime       | OpenShift: two application pods (rolling update, `maxUnavailable: 0`, `preStop`, PodDisruptionBudget, preferred anti-affinity), one PostgreSQL pod with a 5 GiB volume; non-root arbitrary UID, read-only root filesystem, all capabilities dropped. |
| Delivery      | Protected `main` (pull request and green **CI Success** required), CodeQL, Trivy, npm audit, Playwright journeys; releases publish a tested, scanned image with SBOM; deployment is operator-led with an idempotent installer.                       |

## Security

**Controls verified.** Origin and JSON content-type checks on every mutation (CSRF); `HttpOnly`, `SameSite=Strict`, `__Host-` session cookies; scrypt password hashing with timing-safe comparison and a dummy hash for unknown accounts; random tokens stored as SHA-256 hashes (sessions, share links, invitations, recovery, MCP); OIDC with state bound to a cookie, nonce and PKCE, fixed redirects; server-side allowlist projection for visitors (never CSS hiding); rich text stored as validated JSON and rendered without HTML, links limited to `http`, `https`, `mailto`; uploaded documents parsed in a worker thread with size, entry-count, XML depth and time limits; AI output parsed with strict schemas and applied only after user review; errors logged without payloads.

**Findings and fixes**

| Severity  | Finding                                                                                                                                                                         | Fix                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Medium    | Anonymous holders of a form or visitor link could fill the shared database: public writes were only rate-limited per address (about 3 GB a day from one address against 5 GiB). | Storage quotas per published form (5,000 responses, 100 MiB) and per visitor link (2,000 comments), enforced under the row lock that serializes submissions. |
| Low       | The 7 MB JSON body of the document import was parsed before authentication.                                                                                                     | The session is resolved first; anonymous callers are refused before the body is read.                                                                        |
| Hardening | Helmet's default CSP allowed fonts and styles from any HTTPS origin.                                                                                                            | `font-src 'self' data:` and `style-src 'self' 'unsafe-inline'`; a test pins every header and the E2E journeys run under the policy.                          |
| Hardening | No record of administrator actions.                                                                                                                                             | `audit_events`: action, actor, target, client address, non-secret detail, written in the same transaction as the change, 400-day retention.                  |

**Accepted risks.** Sign-up answers "account exists" for a known email (email enumeration), rate-limited to 20 attempts per 15 minutes per address, as most self-service products do; restrict sign-up to domains or close it if that matters. Rate-limit counters are per pod, so a client spread over both pods can reach twice a limit. The audit trail stores administrators' IP addresses (declared in `SECURITY.md`). The application does not replace a WAF or network-level DDoS protection.

**Not verified here.** gstack's qualified scanners (gitleaks, OSV, Semgrep) and runtime reproduction need a Docker socket this environment lacked; CI covers dependencies (npm audit, Trivy) and code (CodeQL). The organization's real LLM, OIDC and SMTP services were not available and are validated only with local mocks.

## Load and resilience

`loadtest/run.mjs` reproduces browser traffic: visitors polling a public link every three seconds, editors with their own accounts polling, sending presence heartbeats and saving with version conflicts. One application process on a 4-core container that also ran PostgreSQL and the load generator:

| Scenario                                          | Throughput | Visitor p50 / p95 / p99 | Save p95 | Failures |
| ------------------------------------------------- | ---------- | ----------------------- | -------- | -------- |
| 300 visitors + 20 editors behind one address      | 103 req/s  | 3 / 5 / 12 ms           | 18 ms    | 0        |
| 1000 visitors + 100 editors, 10 sessions          | 355 req/s  | 3 / 13 / 95 ms          | 21 ms    | 0        |
| 1500 visitors + 100 editors, 10 sessions (stress) | 504 req/s  | 4 / 295 / 1020 ms       | 26 ms    | 0        |

**Defect found and fixed.** The former limit of 600 requests per minute per address refused half the requests of a room of 100 visitors behind one address (a meeting-room NAT or a company proxy) within a minute. Signed-in requests are now counted per account (1,200 per minute) and the per-address guard is sized for several hundred visitors behind one address (12,000 per minute).

**Capacity.** One pod serves about 1,000 people following sessions and 100 editing with a p95 under 25 ms; the manifests run two. Beyond about 450 requests per second a process saturates: latency grows, nothing fails. Memory stayed near 325 MiB under the stress run, within the 512 MiB limit.

**Resilience.** Updates replace pods one at a time and wait for `/api/ready`; clients recover through their next poll. Two pods starting together used to race on schema creation in PostgreSQL (reproduced); startup is now serialized by an advisory lock, covered by a three-pod test. Presence moved from process memory to PostgreSQL so both pods show the same collaborators. The bundled PostgreSQL is a single pod: plan backups and a tested restore (`docs/operations.md`), or use a managed PostgreSQL through the external-database mode.

## Code quality

| Check              | Before (gstack `/health`)              | After                                                                                                            |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| TypeScript         | 0 errors                               | 0 errors                                                                                                         |
| Lint               | not configured                         | ESLint 10 (TypeScript, React hooks, jsx-a11y): 0 errors, 80 legacy warnings under a budget that may only go down |
| Tests              | 287 passed (SQLite), 288 (PostgreSQL)  | 296 passed (SQLite, one PostgreSQL-only test skipped), 297 (PostgreSQL); 7 E2E journeys                          |
| Dead code (knip)   | 26 unused exports, 7 duplicate exports | 0                                                                                                                |
| Shell (shellcheck) | 2 findings                             | 0                                                                                                                |
| Composite          | 7.8 / 10 (lint not scored)             | 8.0 / 10 (lint scored strictly on its 80 budgeted warnings)                                                      |

CI now gates lint, dead code and shell scripts in addition to TypeScript, tests on both databases, build, formatting, audit, manifests and the E2E journeys.

## Compared with RetroGemini

| RetroGemini practice                                                        | MeetLoom                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| gstack required, routing rule, `.claude` bootstrap hooks                    | Adopted: same three hooks and routing table (`AGENTS.md`).                                                               |
| ESLint with jsx-a11y and a two-way warning budget                           | Adopted (`scripts/lint.mjs`).                                                                                            |
| Enforcing self-only CSP pinned by tests                                     | Adopted, with helmet and `tests/security-headers.test.ts`.                                                               |
| Audit trail of privileged actions                                           | Adopted (`server/audit.ts`), closed action set with an emitter test.                                                     |
| Zero-downtime rules, multi-pod state                                        | Adopted: rules in `AGENTS.md`, state in PostgreSQL, rolling update with two pods.                                        |
| Load-test harness                                                           | Adopted, adapted to polling (`loadtest/`).                                                                               |
| Offline / air-gapped rule                                                   | Adopted in `AGENTS.md`, enforced by the CSP.                                                                             |
| Changelog of user-visible changes                                           | Adopted (`CHANGELOG.md`); versions stay semantic (`package.json`) instead of RetroGemini's `VERSION` file.               |
| Configuration parity, regression-test rule, PR follow-up                    | Adopted in `AGENTS.md`.                                                                                                  |
| Pull request template, pinned actions, Dependabot auto-merge, CodeQL, Trivy | Already present.                                                                                                         |
| Husky pre-commit hook                                                       | Not adopted: CI enforces the same checks, and the web-session bootstrap installs dependencies without lifecycle scripts. |
| Automated accessibility audit (axe) and `ACCESSIBILITY.md`                  | Not yet: jsx-a11y runs in lint; an axe audit of the main screens is the recommended next step.                           |
| Production-build E2E for the CSP                                            | Already covered: MeetLoom's E2E suite always runs the production build through the server.                               |

## Recommendations

1. Test a PostgreSQL backup and restore, and alert on database volume usage (the quotas bound anonymous growth, not signed-in growth).
2. Validate OIDC, SMTP and the LLM against the real services in development.
3. Add an axe accessibility audit of the main screens to the E2E suite and publish an accessibility statement (Geneva public-sector obligations).
4. Reduce the 80 lint warnings when touching the related code, and lower the budget each time.
5. Rerun `/cso` with Docker available to use its qualified scanners, and `loadtest/run.mjs` against the development environment before large events.
