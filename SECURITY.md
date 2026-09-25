# Security

Please report suspected vulnerabilities privately through GitHub's private vulnerability reporting when enabled, or directly to the repository owner. Do not put private agendas, visitor tokens, credentials, or infrastructure details in public issues.

MeetLoom 0.1 is in production use. Deploy behind HTTPS with a canonical `APP_ORIGIN`, secure cookies, a protected bootstrap token, PostgreSQL backups, and a trusted internal AI endpoint if enabled. The OpenShift guide documents deployment boundaries and remaining environment-specific checks.

Visitor filtering is enforced by server-side allowlist projections. Never replace it with CSS hiding. Both authenticated and anonymous API contracts must be tested when changing session fields, sharing, export, timer or synchronization behavior.

Dependency updates are proposed by Dependabot; patch and development minor updates merge automatically only after the required checks, including the end-to-end journeys, pass on a protected `main`.

## Hardening in place

- **Headers:** a self-only Content Security Policy (no external scripts, styles, fonts or connections), `nosniff`, `no-referrer`, frame protection and HSTS, pinned by `tests/security-headers.test.ts`. `/api` responses are `no-store`.
- **Requests:** mutations require a matching `Origin`, a JSON content type and a session cookie (`HttpOnly`, `SameSite=Strict`, `__Host-` prefix with HTTPS). Passwords use scrypt; session, share, invitation, recovery and MCP tokens are random and stored only as hashes.
- **Abuse limits:** strict per-address limits on authentication, recovery, AI, imports and public writes; a per-address flood guard and a per-account budget on the whole API; storage quotas on anonymous form responses and visitor comments (`server/quotas.ts`); bounded, time-limited document parsing in a worker thread.
- **Audit trail:** administrator actions are recorded in the `audit_events` table (action, actor, target, client IP address, non-secret detail) in the same transaction as the change, and kept 400 days. This stores IP addresses of administrators and of the first setup; include the table in your data-protection register. Reading it is documented in [docs/operations.md](docs/operations.md).
- **Data export, import and backups:** administrator only, with the administrator's password (except OIDC accounts) and, to replace data, a typed confirmation; audited. Exported and downloaded archives are encrypted with a passphrase (scrypt, AES-256-GCM, tampering refused), limited in decompressed size, and never contain sign-ins or one-time links. Replacing data signs everyone out and first takes a safety backup. Backups kept in the database contain the same data as the database: they are protected like it, not encrypted separately.
- **Review record:** see [docs/security-review.md](docs/security-review.md) and [docs/architecture-review.md](docs/architecture-review.md).
