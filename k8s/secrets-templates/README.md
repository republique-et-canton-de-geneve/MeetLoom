# Environment-specific secrets

Secrets are intentionally excluded from Kustomizations. The installer creates them once with random values and refuses to replace existing credentials. No production password or usable default value is committed here.

To provision through your organization's secrets manager, create these resources in each namespace:

- `meetloom-database`: keys `POSTGRESQL_USER=meetloom`, `POSTGRESQL_DATABASE=meetloom`, a random `POSTGRESQL_PASSWORD`, and `DATABASE_URL` constructed with the same credentials. Add annotation `meetloom.io/database-mode: bundled`. For an external database: only `DATABASE_URL` and annotation `meetloom.io/database-mode: external`.
- `meetloom-auth`: a random `BOOTSTRAP_TOKEN`, independent of the PostgreSQL password.
- `meetloom-ai` if needed: key `LLM_API_KEY`.

Sensitive values belong in `data`/`stringData` keys of Kubernetes `Opaque` Secrets, never ConfigMaps. The application uses a separate `meetloom-settings` ConfigMap for `APP_ORIGIN`, `LLM_BASE_URL`, `LLM_MODEL`, and optional `LLM_VISION_MODEL`. Optional OIDC/SMTP resources are documented in the installation guide.

Do not reuse RetroGemini secrets or copy development secrets to production. Keep values in your secrets manager so credentials can be restored if a Kubernetes resource disappears. Passwords already initialized in PostgreSQL do not change when the Secret is merely updated.

See the [installation guide](../../docs/deployment.md) for the complete workflow.
