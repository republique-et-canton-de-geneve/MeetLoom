# Security

Please report suspected vulnerabilities privately through GitHub's private vulnerability reporting when enabled, or directly to the repository owner. Do not put private agendas, visitor tokens, credentials, or infrastructure details in public issues.

MeetLoom 0.1 is a first version awaiting product validation. Deploy behind HTTPS with a canonical `APP_ORIGIN`, secure cookies, a protected bootstrap token, PostgreSQL backups, and a trusted internal AI endpoint if enabled. The OpenShift guide documents deployment boundaries and remaining environment-specific checks.

Visitor filtering is enforced by server-side allowlist projections. Never replace it with CSS hiding. Both authenticated and anonymous API contracts must be tested when changing session fields, sharing, export, timer or synchronization behavior.

Dependency updates are proposed by Dependabot. Automatic merging remains disabled until the user-approved end-to-end checks and required branch protections exist.
