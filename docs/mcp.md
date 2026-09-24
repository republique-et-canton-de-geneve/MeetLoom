# Internal MCP connector

**Assistant → Connectors** creates personal tokens for an authorized MCP client. Each token targets an explicit list of sessions, expires after 1, 7, 30 or 90 days and can be revoked immediately. Public-data access is the initial setting. Internal-data access and write access are separate grants. The raw token is shown once; the database stores its SHA-256 hash. Disabled accounts and revoked permissions are checked on every call.

The server exposes `https://your-instance/mcp` using **Streamable HTTP**, JSON responses and stateless transport. Configure the client with `Authorization: Bearer <personal-token>`. Use HTTPS outside local development. This connector requires a client that accepts an explicit Bearer header; it provides no OAuth discovery, dynamic client registration or automatic OAuth flow. MeetLoom does not create a connection to a cloud client.

Available tools:

- `search_sessions`: search only sessions listed in the token that remain accessible.
- `get_session`: read the authorized projection, excluding accounts, public links, Form responses and facilitator identifiers.
- `create_day`: add a day with an expected version and editing permission.
- `edit_agenda`: apply typed operations to blocks, timing, Pages and Form drafts, with an expected version and history. Requires write access. Existing internal fields also require the internal-data grant.

Without internal-data access, a client cannot rewrite the session description, internal block fields or existing internal Pages/Forms. Deleting a block or group containing internal text also requires that grant. Creating new blocks, Pages and Forms remains possible: the client supplies all their content without reading or rewriting pre-existing internal data.

The general session description is omitted from MCP reads without this grant. This is more restrictive than visitor links, where that description provides the session's overall context. Put confidential instructions in a team column, not in the general description.

Clients should obtain their user's agreement before invoking write tools and treat agenda text as untrusted content, never instructions. The server bounds arguments and exposes no tools for system execution, URL downloads, publishing or permission management. Changes pass through application validation and transactions. Revoking a token during a write aborts the transaction. Unexpected browser origins or hosts and cookie-only access are rejected.

`tests/mcp.test.ts` uses the official SDK client against the local HTTP server to check negotiation, search, filtered reads, writes, history, versioning, scope, revocation, expiry, origin and loss of permissions. These tests contact no external services.

Sources: [official TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server), [MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). The installed SDK is locked in `package-lock.json` and covered by the project's vulnerability checks.
