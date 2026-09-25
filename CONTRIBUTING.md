# Contributing to MeetLoom

Use Node.js 24 and `npm ci`, then follow [local startup](README.md). Create a `codex/description` branch or your own working branch and submit a PR. Do not commit `.env` files, SQLite databases, dumps, secrets, or private agendas.

Before opening a PR, run `npm run lint`, `npm run deadcode` and `npm run check`, and format changed files with Prettier. Add a line to `CHANGELOG.md` for user-visible changes. The complete list of rules is in [AGENTS.md](AGENTS.md). API contracts must continue to pass on SQLite and PostgreSQL; CI covers both. To test PostgreSQL locally, set `TEST_DATABASE_URL` to a test database whose user can create and drop isolated schemas, then run `npm test`.

The [architecture](ARCHITECTURE.md) explains where changes belong. Reuse `tests/support.ts` for HTTP tests: it starts an application on loopback, creates isolated accounts, and cleans up its resources. Never point `TEST_DATABASE_URL` at a production database. Schema changes are additive and idempotent; include a compatible migration and a test on both engines when changing storage.

Authorization, visitor projection, persistence, or agenda format changes need meaningful domain/API tests. Verify visual changes in a browser. The nominal end-to-end journeys live in `e2e/` (Playwright): run `npm run test:e2e` (it builds, then starts the production build on a disposable SQLite database). Keep them few and stable: accounts, agenda editing, visitor privacy, and facilitation.

Agenda writes use the central version check; related writes such as comments, responses, and sharing also check closure and trash state under a transactional lock. Transfers between sessions must never succeed partially. Test revoked access, identifiers belonging to other sessions, concurrent requests, and public data privacy.

Interfaces include English and French labels, loading states, recoverable errors, and the account's actual permissions. Editor, administration, and form modules load according to the workflow; compare bundle sizes after substantial additions without hiding build warnings.

Dependencies go through Dependabot and the same checks as application code. GitHub Actions remain pinned to their commit SHA. Patch updates and development minor updates are auto-merged once the required checks pass (`.github/workflows/dependabot-auto-merge.yml`); major and production minor updates wait for review. Some majors are held on purpose (`ignore` rules in `.github/dependabot.yml`, each with its reason): TypeScript stays on 6.x until typescript-eslint supports 7 (a monthly workflow opens an issue when it does), and Node.js with `@types/node` moves by hand, together with `engines` and CI, to the next LTS line. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

Manifests are generic: keep installation-specific namespaces, domains, and registries in an operational overlay, outside distributed values. Prepare a release by updating the version in `package.json` and the lockfile together. The [publication procedure](docs/deployment.md) covers Docker Hub, artifacts, and manual deployment by the operator.

The user accepted V1 and the E2E suite gates CI and releases. Releases and deployments stay operator decisions. The Render button is an installation descriptor available to operators; its free demo uses ephemeral storage.
