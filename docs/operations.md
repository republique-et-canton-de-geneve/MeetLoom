# Operating MeetLoom

This guide complements [installation](deployment.md). Examples use the development namespace `meetloom-dev`. For production, explicitly replace it with `meetloom-prod`. Commands are run by the operator, never by CI. Engineering files draw on the [RetroGemini audit](engineering-reference.md), with the first version intentionally limited to one application pod.

## Check the installation

```bash
oc -n meetloom-dev get deployments,pods,svc,route,pvc
oc -n meetloom-dev rollout status deployment/meetloom
oc -n meetloom-dev logs deployment/meetloom --tail=100
oc -n meetloom-dev exec deployment/meetloom -- node -e "fetch('http://127.0.0.1:3000/api/ready').then(async r=>{console.log(r.status);process.exit(r.ok?0:1)})"
```

`/api/health` confirms that the process responds. `/api/ready` checks database availability. Readiness must not depend on the optional LLM: an LLM outage must not remove the application from service. Do not use logs to store prompts or private meeting content.

| Symptom                 | Check                                                                         |
| ----------------------- | ----------------------------------------------------------------------------- |
| `ImagePullBackOff`      | Published image reference, registry access, and ServiceAccount pull secret    |
| PVC `Pending`           | Default storage class, quota, and available capacity                          |
| Pod rejected by an SCC  | No manually added UID, unprivileged policy, and a compatible PostgreSQL image |
| Cookie/session rejected | HTTPS, exact `APP_ORIGIN`, Route, and trusted proxy count                     |
| Readiness failure       | Application/database logs, `DATABASE_URL`, DNS, and PostgreSQL network access |
| AI unavailable          | `LLM_BASE_URL` and `LLM_MODEL` in the ConfigMap, restart after changes        |
| LLM certificate error   | Mounted internal CA and `NODE_EXTRA_CA_CERTS`, without disabling TLS          |

## Back up and restore

For managed PostgreSQL, use the platform's backup mechanism and regularly test restoration. For the bundled database, a logical backup can be extracted from Bash as follows:

```bash
PG_POD=$(oc -n meetloom-dev get pod -l app.kubernetes.io/name=meetloom-postgresql -o jsonpath='{.items[0].metadata.name}')
oc -n meetloom-dev exec "$PG_POD" -- sh -c 'PGPASSWORD="$POSTGRESQL_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRESQL_USER" -d "$POSTGRESQL_DATABASE" -Fc -f /tmp/meetloom.dump'
oc -n meetloom-dev cp "$PG_POD:/tmp/meetloom.dump" ./meetloom.dump
oc -n meetloom-dev exec "$PG_POD" -- rm -f /tmp/meetloom.dump
```

Keep the copy outside the cluster and apply your organization's retention rules. The dump contains agendas, accounts, and private data; encrypt it and restrict access. `oc cp` requires `tar` in the database image; if unavailable, use the platform's backup tooling. Also retain the image version/digest and settings needed for restoration, with secrets in your secrets manager.

Test restoration in a separate project first. Prepare a compatible empty database, copy the dump into its pod, then use `pg_restore --no-owner` with its user and database. Check sign-in, several agendas, permissions, and shared links. Restoring into a live database requires a planned shutdown and data replacement procedure, not simply reapplying manifests.

For local SQLite, stop the application before copying `meetloom.sqlite` and any WAL/SHM files, or use the SQLite backup API. Copying only the main file during a write is not a reliable backup procedure. A persistent Docker volume does not replace an external backup.

## Update and roll back

1. Record the current image with `oc -n meetloom-dev get deployment meetloom -o jsonpath='{.spec.template.spec.containers[0].image}'`.
2. Take a backup and read any migration instructions.
3. Change only the `app` container image in the `meetloom` Deployment, through the console or `oc set image`. Secrets, configuration, and the PVC are preserved. If the release changes manifests, rerun its installer with the new image.
4. Check readiness, then sign-in, agenda opening, a visitor link, and the timer in a browser.

If the version is incompatible, restore the previous image with `oc set image` or the console. An older image may not be able to read a migrated schema: data rollback then requires the backup and corresponding migration procedure. The application updates pod by pod without interruption; only a change to the PostgreSQL manifest restarts the database briefly (release notes say so).

Editing the PostgreSQL password Secret is not a complete rotation. Change the password in PostgreSQL and then in `DATABASE_URL` as a coordinated operation. Secrets/ConfigMaps are injected as environment variables, so applying their changes is insufficient: restart affected pods. The installer never performs an implicit rotation.

## Network and private data

The Route terminates TLS and redirects HTTP to HTTPS. Route-to-pod networking depends on platform policy; if end-to-end encryption is required, prepare an overlay with re-encrypt termination and server certificates.

`k8s/optional/database-networkpolicy.yaml` is not applied automatically. It restricts PostgreSQL ingress to application pods in the namespace, provided no other NetworkPolicy already grants broader access. Before using it:

```bash
oc -n meetloom-dev get networkpolicy -o yaml
oc -n meetloom-dev apply -f k8s/optional/database-networkpolicy.yaml
```

Then verify that an application pod can reach the database and a pod without the application label cannot, using a diagnostic image approved by your organization. A NetworkPolicy's presence alone does not prove isolation. Platform network rules must preserve outbound access to the LLM, external PostgreSQL, and DNS.

Treat visitor sharing as read access for anyone holding the link. Revoke links that are no longer needed. Column privacy is enforced through server projections; an export or public presentation view must never retrieve hidden organizer fields.

## Rate limits and proxy configuration

Rate limits use in-process memory, with independent budgets per middleware:

| Scope                                                      | Budget                                                 | Key                                            |
| ---------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `/api`, excluding health/readiness probes                  | 12,000 requests per minute (flood guard)               | Client IP                                      |
| `/api` for signed-in users                                 | 1,200 requests per minute                              | Authenticated account, regardless of client IP |
| Setup, sign-in, password change, and invitation acceptance | 20 requests per 15 minutes, shared across these routes | Client IP                                      |
| Profile updates and account deletion                       | 20 requests per 15 minutes, shared across both routes  | Authenticated account, regardless of client IP |

Additional endpoint limits apply to recovery, AI, forms, and MCP. Public links also have storage quotas (`server/quotas.ts`): a published form keeps at most 5,000 responses and 100 MiB of answers and images (deleting responses frees room), and a visitor link at most 2,000 comments. Beyond them, the form answers `FORM_FULL` and comments `VISITOR_COMMENT_LIMIT`. Exceeding a budget returns HTTP 429 with `RATE_LIMITED`; honor `Retry-After` before retrying. IP-based keys group IPv6 addresses by `/56` subnet by default. Users behind the same public IP share IP-based budgets: the per-address ceiling leaves room for a meeting room of several hundred visitors polling a public link every three seconds (see [loadtest/README.md](../loadtest/README.md)), while signed-in users are counted per account.

Set `TRUST_PROXY` to the actual trusted proxy hop count: the default is `0`, while the supplied OpenShift manifests use `1`. The trusted edge must replace client-supplied forwarding headers, and clients must not bypass that proxy path. An incorrect count or spoofable `X-Forwarded-For` can undermine IP-based limits.

Restarting the application resets counters. Counters are kept per pod: with the two application pods of the OpenShift manifests, a client spread across both can reach at most twice each limit (the router usually keeps a browser on one pod). A shared rate-limit store would be needed for exact limits across many replicas.

## Reading the audit trail

Administrator actions are recorded in the `audit_events` table: `installation.setup`, `settings.signup`, `settings.sound`, `account.invite`, `account.update` (enable, disable, administrator right), `account.access-revoke` and `account.reset` (a password-reset link was issued; the link itself is never stored). Each row holds the time, the acting account, the target, the client IP address and a small JSON detail. Rows older than 400 days are removed when new events are written. There is no screen for it; read it with SQL, for example from the PostgreSQL pod:

```bash
oc -n meetloom-dev exec deploy/meetloom-postgresql -- \
  psql -U meetloom -d meetloom -c \
  "SELECT a.at, a.action, u.email AS actor, a.target, a.detail, a.ip FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.at DESC LIMIT 50"
```

The application offers no path to change or delete rows; the database does not enforce it, so restrict direct database access accordingly.

## Retention, closure, and optional services

Archiving organizes the dashboard without removing existing access. Closing makes the agenda read-only and closes public contributions; deleting immediately removes visitor and collaborator access while retaining a recoverable session for 30 days. Deleted agenda items remain recoverable for 72 hours. Expired sessions are purged in bounded batches when the trash is viewed or used; this is not a precisely scheduled background purge. Copies in backups follow their own retention policy. See the [workspace, history, and lifecycle guide](workspaces-and-lifecycle.md).

Additive migrations run at startup before the server becomes available. A backup and verified restoration remain necessary before schema updates. The log and versions are part of the database: preserving PostgreSQL also preserves permissions, invitations, sharing links, forms, and AI conversations. Do not reset the database to update the application.

When OIDC or SMTP is enabled, add their destinations to the platform's outbound network rules and keep credentials out of Git. Test OIDC sign-in, account recovery, and a test email after rotating credentials. Email reminders and digests are optional and follow user preferences; the application process handles them, reinforcing the current single-pod limit. The [services guide](services-auth-mail.md) documents variables, access policies, and behavior when services are absent.

## CI and GitHub publication

The workflows define:

- **CI Success**: aggregates type checks, SQLite and PostgreSQL tests, the build, dependency audit, and manifest rendering;
- **CodeQL**: code security analysis on PRs and on a schedule;
- **Container scan**: starts the image with an arbitrary UID and read-only root filesystem, then runs Trivy, blocking on fixable high/critical vulnerabilities;
- **Release GitHub and Docker Hub**: a published GitHub Release or manual run from `main` triggers type checks, SQLite/PostgreSQL tests, build, audit, and scan; the versioned image is published to Docker Hub, with an SBOM, digest, and OpenShift archive attached to the Release.

Configure GitHub branch protections/rulesets to require `CI Success`, `CodeQL`, and `Container scan`, prohibit unintended direct pushes, and require resolved discussions. Exact displayed names may include the workflow; select checks actually produced by the first run. A YAML file does not configure these protections itself. CodeQL must be available for the repository; if it becomes private within an organization, check permissions/licensing before migration. Any runner, registry, and infrastructure costs depend on the chosen hosting; the application introduces no mandatory SaaS service.

To also block PRs on CodeQL alerts, configure GitHub's **Require code scanning results** rule with CodeQL and the selected severity threshold. A successful analysis job does not mean no alerts were found. Trivy results are also uploaded to Security as SARIF. Enable Dependabot alerts, security updates, and secret push protection when available. See [code scanning merge protection](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection).

Dependabot opens npm, GitHub Actions, and Docker updates. Actions are pinned by SHA, so updates pass through a PR. **Automatic merging is absent in V1**, following the requested order: stabilize and accept the product, then add E2E tests.

After V1 acceptance, add a small Playwright suite covering the production application, require its check, and only then introduce automatic merging of minor/patch Dependabot PRs. Automatic merging must rely on effective branch protections; major updates still require review. Fail when a test is skipped or canceled rather than treating an absent check as success.

The release workflow publishes version `X.Y.Z` and a `sha-COMMIT` tag from the verified commit. It neither modifies manifests nor deploys the cluster. The GitHub variable `DOCKERHUB_REPOSITORY` and secrets `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` configure publication; do not add OpenShift access to GitHub. Retain the Release's digest and SBOM in your internal artifact repository. Validate in development, then promote the same image to production.

## Remaining checks on the target platform

Local syntax and rendering checks do not prove admission by actual SCCs, image pulls, or storage availability. Before declaring an environment ready, validate rootless startup, probes, the Route/certificate, first-account setup, restart with persistence, a database backup/restore, and the internal LLM connection. The maintained E2E suite will be added after functional acceptance of the first version.
