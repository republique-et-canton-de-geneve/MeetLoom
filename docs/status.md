# Implementation status

The first implementation is available for user acceptance testing. The project includes the application, English repository documentation, Gstack tooling guidance, CI/security/release workflows, Docker, generic Kubernetes/OpenShift manifests, and a Render deployment blueprint. The interface supports French and English with an original MeetLoom visual identity. Work is stopping at the user's requested intermediate checkpoint; the [agent handoff](handoff.md) records how to continue without conversation history.

Implemented capabilities and comparative scenarios are tracked in [product-parity.md](product-parity.md). Actual browser evidence is recorded in [manual-qa.md](manual-qa.md). Implemented code, automated contract coverage, manual checks, and user acceptance are distinct: this is not a claim that every SessionLab scenario has been manually certified.

The three agreed exclusions remain the Parking lot, block/session library, and attachments in blocks.

## Validation sequence

Local checks passed: 219 tests on SQLite and 219 on PostgreSQL, TypeScript checks, a production build, and a dependency audit reporting zero vulnerabilities. The canonical repository is now [republique-et-canton-de-geneve/MeetLoom](https://github.com/republique-et-canton-de-geneve/MeetLoom), with the implementation on its [codex/meetloom-v1 branch](https://github.com/republique-et-canton-de-geneve/MeetLoom/tree/codex/meetloom-v1).

On the previous personal repository, GitHub Actions could not start the jobs on September 23, 2026 because of an account billing issue. This was a repository/account environment result before any steps executed, not a failing application test. The organization repository has its own workflow runs and settings; that earlier billing result does not establish their status. Repository secrets, variables, and branch protections are not copied by a Git push.

The organization's [first pull-request CI run](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35876559322) passed all jobs: SQLite/PostgreSQL tests, TypeScript, build, formatting, dependency audit, and deployment manifests. The [Security run](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35876559885) also built the exact Dockerfile and passed the arbitrary-UID/read-only-root runtime check. Its CodeQL upload was rejected because the repository's Default setup conflicts with this custom workflow's advanced configuration. These two CodeQL configuration modes must be reconciled before claiming a successful Security run.

That initial container scan found four high-severity vulnerabilities in npm's bundled dependencies, outside the application's dependency tree. The runtime image now removes npm/npx after installing production dependencies because it starts directly with Node. The SARIF action also explicitly respects the configured HIGH/CRITICAL severity filter; those severities remain blocking.

For commit `4d2b6b96a8ec0339849d806e9b49dde54db07e74`, the organization's [CI run](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35877168096) passed every job. The [container security job](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35877168133/job/107235972949) also passed: the exact Dockerfile built, the arbitrary-UID/read-only-root smoke test succeeded, and Trivy passed the unchanged blocking policy for fixable HIGH/CRITICAL vulnerabilities.

The user approved the RetroGemini-style advanced CodeQL workflow. Default setup was disabled on MeetLoom, and [the rerun](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35877168133/job/107258431671) successfully uploaded its analysis. It reported 11 missing-rate-limit alerts and three unused imports. The shared limiter now uses `express-rate-limit`, which CodeQL recognizes, with IPv6 subnet aggregation; profile changes and account deletion also receive a shared per-account password-verification budget. The unused imports were removed. Current validation results belong to the [implementation PR's checks](https://github.com/republique-et-canton-de-geneve/MeetLoom/pull/1/checks); distinguish the CodeQL findings check from the analysis job's successful execution.

The maintained nominal E2E suite and any dependency auto-merge policy come **after user acceptance**. The subsequent delivery sequence is a GitHub release, Docker Hub publication, then operator-led OpenShift development and production deployments. None of those deployment steps has been performed.

## Environment limits

- The organization's Qwen endpoint has not been provided. Its optional adapter and proposal/application flow were tested with a local mock, not the real model.
- OIDC and SMTP are optional and have automated contract coverage; production identity and mail services still require operator configuration and verification.
- The local Docker engine could not reach the registry during the exact image build. The organization's GitHub runner subsequently built and checked that image successfully; no local DNS settings were changed.
- Chrome can be controlled, but native PowerPoint is unavailable to the browser tools. The floating window can be opened in Chrome; its behavior above a real slideshow still requires an environment check.
- Microsoft Office rendering and audible playback were not physically verified. The manual test record states these limits explicitly.
