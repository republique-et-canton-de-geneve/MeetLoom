# Organizational sign-in and internal email

OIDC and SMTP are optional. Without their variables, the application uses local accounts only and contacts no identity provider or mail server. Tests use mock adapters: no real messages are sent during development.

## OIDC

Register a confidential **Authorization Code** client with your internal provider, such as Keycloak. Register the exact URI `${APP_ORIGIN}/api/auth/oidc/callback`, enable PKCE S256, and provide the `sub`, `email`, `email_verified`, and `name` claims with the `openid email profile` scopes.

```dotenv
APP_ORIGIN=https://meetloom.internal.example.org
COOKIE_SECURE=true
OIDC_ISSUER=https://identity.internal.example.org/realms/organisation
OIDC_CLIENT_ID=meetloom
OIDC_CLIENT_SECRET=your-private-client-secret
OIDC_ACCOUNT_POLICY=existing
```

`existing` permits initial linking only when the email **verified by this trusted provider** matches an existing local account. This means the organization trusts its provider to control the work email address; do not configure a public provider or a realm allowing self-declared addresses. `invited` also permits account creation when an active administrator invitation matches that address. Workspace invitations retain their role on SSO acceptance. No account created through SSO becomes a global administrator. The first administrator must still use local setup.

After linking, identity is the `(issuer, sub)` pair; a new `sub` cannot take over an already linked account through a recycled address. Disabled accounts remain refused. Sign-out closes the MeetLoom session; it does not sign out of every application connected to the provider. The client secret stays on the server, and no provider access/refresh token is retained after sign-in.

The flow uses random state and nonce values, PKCE S256, browser binding through an HttpOnly/SameSite=Lax cookie, ten-minute expiry, and atomic single-use consumption. The regular session cookie retains SameSite=Strict protection. The [openid-client](https://github.com/panva/openid-client) library validates responses and ID tokens; provider connections require HTTPS and valid certificates. Internal certificates can be added with `NODE_EXTRA_CA_CERTS`, without disabling TLS verification.

## SMTP and password recovery

```dotenv
SMTP_HOST=smtp.internal.example.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=service-account
SMTP_PASSWORD=your-private-password
SMTP_FROM=meetloom@example.org
SMTP_SCHEDULED=true
```

With `SMTP_SECURE=false`, STARTTLS is **required**, not opportunistic. Port 465 normally uses `SMTP_SECURE=true`. Authentication is optional for an internal relay that handles it another way; provide username and password together. Certificates are verified, and Nodemailer file/URL content access is disabled. See the [official SMTP transport documentation](https://nodemailer.com/smtp).

The **Forgot password** link appears when SMTP is configured. Its response is identical for known, unknown, disabled, and temporarily rate-limited addresses. A fifteen-minute cooldown per address and an IP rate limit reduce abusive sends. The link is valid for one hour, can be used once, and only its hash is stored in the database. A sending failure invalidates the link. The body containing the link stays in memory during sending; it is never logged or saved in a persistent queue. If the application restarts before sending, the user must request a new link. A successful reset closes all the account's other local sessions.

## Digests and reminders

Each account explicitly chooses digests and/or reminders in its profile; both preferences are disabled by default. `SMTP_SCHEDULED=false` disables only the scheduler and leaves password recovery available.

The built-in scheduler checks work every minute; a single application instance is recommended. Digests group unread notifications from completed hourly intervals as titles and links to sessions that remain accessible. They do not copy private comment text. The last processed interval is stored in the database; recovery after an interruption is limited to seven days.

Reminders are sent three calendar days before the session's first date, in its timezone. Only owners and editors receive them, including effective workspace roles. They summarize open tasks, materials, and the number of unresolved discussions; lists are limited to 30 items. They contain no secret public links. Archived sessions, revoked access, and disabled accounts are excluded.

A persistent delivery key and temporary lock prevent ordinary duplicate sends; failures are retried at most three times, at least five minutes apart. As with any SMTP delivery, stopping between relay acceptance and database acknowledgement can occasionally cause a duplicate. Logs contain no addresses, bodies, or tokens. Functional reminder reference: [SessionLab documentation](https://help.sessionlab.com/en/articles/11786738-stay-prepared-with-pre-session-reminder-emails).

## OpenShift / Kubernetes

The Deployment optionally loads a ConfigMap and Secret, both named `meetloom-services`. The base installation works without them. Copy and adapt the [non-secret example](../k8s/optional/services-config.example.yaml), removing settings for any service you do not use. Store secrets in a local file excluded from Git, such as `.env.services-secrets`:

```dotenv
OIDC_CLIENT_SECRET=your-private-value
SMTP_USER=service-account
SMTP_PASSWORD=your-private-value
```

After selecting the target project, apply the configuration and secret, then restart the Deployment:

```sh
oc apply -f path-to-your-services-config.yaml
oc create secret generic meetloom-services --from-env-file=.env.services-secrets --dry-run=client -o yaml | oc apply -f -
oc rollout restart deployment/meetloom
oc rollout status deployment/meetloom
```

Keep these values in your usual secret manager. GitHub needs neither cluster access nor SMTP/OIDC credentials. If a network policy controls egress, allow internal DNS, the HTTPS OIDC provider, and the SMTP relay. Docker Compose passes the same variables; place an HTTPS proxy in front of the application and adjust `APP_ORIGIN`/`COOKIE_SECURE` before enabling these services in production.

## Self-service sign-up

By default, accounts are created from administrator invitations (or organizational sign-in with `OIDC_ACCOUNT_POLICY=invited`). An administrator can let people create their own account from the sign-in page in **Account & team → Installation settings**, optionally restricted to a list of email domains. Accounts created this way are never administrators. MeetLoom does not verify the address by email, so keep this option for an internal network, or restrict it to your organization's domains.
