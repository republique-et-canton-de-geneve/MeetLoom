# Gstack

Gstack was installed before implementation, as requested, from the [official repository](https://github.com/garrytan/gstack).

- Installed version: `1.87.6.0`.
- Source commit: `636175d3496e1f5087d65522e69d314584c7b236`.
- Native Codex installation: `setup --host codex --prefix --no-plan-tune-hooks --no-timeline-stop-hook`.
- 54 skill directories in `~/.codex/skills/gstack*` on the development machine.
- Official Bun 1.4.2 downloaded with SHA256 verification.
- Browser compiled and health checked; telemetry disabled.
- The optional `/gstack-cso` component was unavailable on this machine without Visual Studio C++ Build Tools. It was not reported as having run.

The clone and executables are in `.tools/`, which Git ignores. They are not included in the MeetLoom image. Gstack instructions are separate from the application runtime.

Preparation included research before implementation, a reasoned decision to start from scratch, explicit data contracts, and review of trust boundaries. The `/review` preamble ran. The strict PR workflow stopped while the repository was still on `main`; the subsequent targeted code review followed Gstack's security and integrity checklist. This targeted review is not a complete `/ship` validation or an external Claude review.

The identified defects were fixed: public projection, account and agenda concurrency, cookie/origin configuration, private-field imports, AI generation and validation, publication, and idempotent scripts. Independent manifest review and PostgreSQL/Linux validation supplemented the code review.

The next targeted review, on `codex/meetloom-v1`, covered accounts/OIDC/SMTP/invitations, transfers, sharing, and MCP. At that point, the new files were still untracked and the external Claude review CLI was unavailable: no complete PR review certification is claimed. See [security-review.md](security-review.md) for reproduced defects, fixes, and coverage limits. Telemetry and automatic commits remained disabled or were never enabled.

The user's decision to defer end-to-end tests until V1 acceptance takes precedence over Gstack's generic QA recommendations. Individual Chrome checks and unit/API tests do not create an end-to-end suite to maintain.

To install Gstack on another machine, follow its current documentation and verify its source before running `setup --host codex`. Do not copy binaries generated on this Windows machine to a Linux host.
