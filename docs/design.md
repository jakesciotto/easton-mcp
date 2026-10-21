# Easton MCP
One remote MCP server that gives Easton coaches, through claude.ai, read access to the gym's data and a small set of audited writes. v1 covers the leaderboard and a set of Easton documents in Google Workspace.

Status: draft, 2026-10-15. Not built. Decided: host on Vercel at `mcp.eastontc.com`; the document registry lives in Supabase; Jake is the Workspace super admin and grants the delegation scopes.

## Goals
1. A coach signs in once with the eastontc.com Google account and asks Claude questions across Easton data.
2. The server owns no domain data. Each product stays the source of truth behind a thin adapter.
3. Every write is explicit, idempotent and audited. No write reaches a product that has no safe write path.
4. New products (duals, Easton+, Mat Lab) attach as adapters without a change to auth or transport.

## Non-goals for v1
- Per-academy filtering of leaderboard reads. The leaderboard is public at eastonpodium.com.
- Writes to competition results, rankings or settings.
- Duals, Easton+ and Mat Lab adapters.
- A web UI beyond the OAuth consent page.

## Consumers
- claude.ai custom connectors (web, desktop, mobile) for coaches. This is the v1 target.
- Claude Code and other MCP clients work with the same server because the transport and auth follow the MCP 2025-06-18 specification.

## Architecture

```
claude.ai  ──OAuth 2.1 + Streamable HTTP──▶  easton-mcp (Hono, Node 22, Vercel)
                                                 │
                       ┌─────────────────────────┼──────────────────────────┐
                       ▼                         ▼                          ▼
              Supabase (leaderboard)     Google Workspace APIs       Supabase (easton-mcp project)
              competitors, entries,      Drive, Docs, Sheets         oauth_clients, auth_codes,
              competitions, erp_history  via service account         refresh_tokens, audit_log
              (publishable key, RLS)     with domain-wide delegation
```

One package, three layers:

1. `server/auth`: the OAuth 2.1 authorization server and resource server.
2. `server/adapters/<product>`: one module per product. Each exports tools and resources.
3. `server/mcp`: the registry that mounts adapters and the Streamable HTTP endpoint at `/mcp`.

The server is stateless. No MCP session store. Every request carries a bearer token and the server validates it on every call.

## Authentication and authorization

### Why the server is its own authorization server
claude.ai discovers the authorization server through Protected Resource Metadata and registers itself with Dynamic Client Registration. Google and Supabase Auth do not offer Dynamic Client Registration. So easton-mcp runs the authorization server itself and delegates the login to Google.

### Claude client facts (claude.com/docs/connectors/building/authentication, read 2026-10-15)
- The hosted apps redirect to `https://claude.ai/api/mcp/auth_callback`. Claude Code redirects to `http://localhost/callback` or `http://127.0.0.1/callback` on any port; the server matches both with the port ignored.
- Claude prefers a Client ID Metadata Document (CIMD) over Dynamic Client Registration when the authorization server metadata advertises `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`. CIMD avoids one new registered client per connection. The server supports CIMD first and DCR as the fallback.
- The 401 must carry `WWW-Authenticate` with `resource_metadata` and may carry `scope` to control the requested scopes. Claude ignores the header on a 200.
- The protected resource metadata `resource` must equal the URL the coach enters, so the canonical resource is `https://mcp.eastontc.com/mcp`, and `authorization_servers` lists one issuer.
- The token endpoint accepts `application/x-www-form-urlencoded`, rotates refresh tokens, and answers `invalid_grant` when a refresh token is dead. Claude appends `offline_access` when `scopes_supported` lists it.
- Discovery, registration and token endpoints must answer within 10 seconds; refresh within 30. A Vercel cold start plus one Supabase round trip must fit; the health check keeps the function warm.
- Anthropic egress is `160.79.104.0/21`.

### Flow
1. claude.ai calls `/mcp` without a token. The server answers 401 with `WWW-Authenticate: Bearer resource_metadata="https://mcp.eastontc.com/.well-known/oauth-protected-resource/mcp", scope="leaderboard:read docs:read leaderboard:write docs:write"`.
2. claude.ai reads the resource metadata, then `/.well-known/oauth-authorization-server`. It identifies itself with its CIMD URL as `client_id`, or registers with `POST /oauth/register` when it cannot.
3. claude.ai opens `/oauth/authorize` with PKCE and `resource=https://<host>`.
4. The server redirects the coach to Google OIDC with `hd=eastontc.com`. Google returns the id token. The server rejects any account outside eastontc.com.
5. The server shows one consent page that names the client and the scopes, then redirects to the claude.ai callback with a code.
6. claude.ai exchanges the code at `/oauth/token`. The server issues an access token (JWT, 1 hour, `aud` = canonical server URL, `sub` = coach email, `role`, `scope`) and a rotating refresh token (30 days).
7. Every `/mcp` request validates the signature, `aud` (`https://mcp.eastontc.com/mcp`), expiry and scope.

CIMD handling: when `client_id` is an https URL, the server fetches the document, requires that its `client_id` field equals the URL, caches it for one hour, and accepts only redirect URIs the document lists. The server allows CIMD documents from `claude.ai` only (`MCP_CIMD_HOSTS`).

Implementation: `@hono/mcp` 0.3.2 ships `mcpAuthRouter`, `StreamableHTTPTransport` and `bearerAuth` for Hono over `@modelcontextprotocol/sdk` 1.32.1. The server supplies a custom `OAuthServerProvider` and a clients store that resolves CIMD URLs and DCR rows. Storage for clients, codes and refresh tokens is a separate Supabase project `easton-mcp`. The server holds a service role key for that project only. For the leaderboard it holds the publishable key alone, so it can never bypass Row Level Security on product tables. The project must not pause: paid tier or a keepalive ping from the health check. Registered redirect URIs are validated exactly. claude.ai callback URLs are an allowlist in env, verified at build time against the current claude.ai documentation.

### Roles
- `coach`: any eastontc.com account. Reads everything in v1. May call the coach writes.
- `admin`: members of a Google Group named in env (`MCP_ADMIN_GROUP`). The server reads the group through the Directory API with the existing domain-wide delegation pattern from Easton+. Admin writes are gated on this role.

Roles are resolved at login and embedded in the token. A role change takes effect at the next token refresh, at most one hour later.

### Scopes
- `leaderboard:read`, `docs:read`, `leaderboard:write`, `docs:write`. claude.ai requests all four; the consent page shows them. Reads are always granted. Writes are granted to coaches, and admin writes additionally check the role claim.

## Adapters

### Adapter contract
Each adapter exports `{ name, tools, resources, health }`. A tool declares `inputSchema` (zod), `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`), the scope it requires, and a handler that receives `{ auth, input }`. The registry enforces the scope before the handler runs. Outputs are compact JSON with a hard cap of 50 KB per call and cursor pagination above that.

### leaderboard (Supabase)
Reads use the publishable key so RLS applies, the same as the public site. The adapter reads persisted columns only (`competitors.erp`, `rank_order`, `rank_change`, `erp_history`, `peer_averages`) and never recomputes rankings. The math stays in the leaderboard.

Tools:
- `search_competitors({ name, academy?, belt?, age_group?, limit })` read
- `get_competitor({ id })` profile, belt, ERP, rank, rank change, every entry, ERP history. read
- `list_competitions({ year?, include_disabled? })` read
- `get_competition_results({ competition_id, academy?, belt?, age_group? })` read
- `get_rankings({ belt?, age_group?, gender?, academy?, limit })` read
- `get_academy_summary({ academy, from?, to? })` medals, entries, active competitors, ERP distribution. read
- `report_data_issue({ competitor_id?, entry_id?, description })` coach write. Inserts a row in `easton_mcp.data_issues` for Jake to triage. Does not touch leaderboard tables.

Resources:
- `easton://leaderboard/weight-classes` the `weight_class_definitions` table
- `easton://leaderboard/ranking-settings` the `ranking_settings` row
- `easton://academies` the nine academies

### docs (Google Workspace)
The server authenticates with a service account that has domain-wide delegation and impersonates the signed-in coach. Google then enforces the coach's own sharing permissions, so the server cannot expose a document the coach cannot open in Drive. Scopes to grant on the service account: `drive.readonly`, `documents.readonly`, `spreadsheets.readonly`, plus `drive.file` and `spreadsheets` if docs writes ship.

Access is limited to a registry table `easton_mcp.documents` (`drive_id`, `kind` folder|doc|sheet|slides, `title`, `writable`, `added_by`, `added_at`, `removed_at`). A folder row admits every file below it. A search outside the registry returns nothing. Admins change the registry through a tool, so a new document needs no deploy.

Tools:
- `docs_search({ query, limit, collection? })` full text through Drive search, scoped to the registered roots. Each root row is a collection named by its title and every result names its collection. read. Shipped first for the SOP set.
- `docs_read({ names })` one to five ids or exact titles; a Doc returns markdown through the Drive export. read. Shipped with docs_search. Sheets and Slides wait for an export type each.
- `docs_list()` the registered collections with their ids. read. Shipped.
- `add_comment({ id, anchor_text?, body })` coach write. A Drive comment under the coach's own name.
- `append_rows({ sheet_id, tab, rows })` admin write, only on registry rows with `writable = true`.
- `register_document({ drive_id, kind, writable })` admin write. Verifies the admin can open the file through the Drive API before the insert.
- `remove_document({ drive_id })` admin write. Sets `removed_at`; no row is deleted.

Resources:
- `easton://docs/registry` the live registry rows

Rate limits: Drive and Sheets reads are capped at 4 concurrent calls per coach with retry on 429, the pattern the leaderboard's sheets layer already uses.

## Tool design rules
1. A tool is a task, not an endpoint. It takes a name or an array of names, carries a shared prefix per adapter, and the adapter states its tool budget in its spec.
2. A tool call makes one data round trip. Lookups that every call needs come from a per instance cache: the document registry for five minutes, a sync version for leaderboard reads, a Google access token for its hour.
3. A common coach question costs at most two tool calls, which the phase gates test.
4. Every tool carries a title, a scope and the three annotations. A description states what the tool does, when to call it and which tool continues the task, and never tells Claude how to behave. An error names the failed input and what a retry should change.
5. Google reaches the server through jose and fetch, with no Google SDK. The function runs in iad1 beside the state project.
6. Planned: read audits leave the response path, the server advertises an instructions field, and audit_log records response bytes.

## Writes: the rules
1. A write tool carries `idempotency_key` in its input. The server stores the key with the result in `easton_mcp.audit_log` and returns the stored result on a repeat.
2. Every tool call, read or write, writes one audit row: coach, tool, input hash, outcome, duration. Inputs for writes are stored in full.
3. A write never calls a product's sync, scrape or settings path.
4. Admin writes act only on rows an admin registered. The registry is data, but only an admin tool writes it, and every change carries an audit row.

## Transport and runtime
- Streamable HTTP at `POST /mcp`, JSON responses, no SSE stream kept open. `GET /mcp` answers 405.
- Hono on Node 22 as one Vercel function, the duals pattern. `NODEJS_HELPERS=0` on the project, the known requirement for a Hono function on Vercel.
- `GET /health` reports version and adapter health without auth.
- Per-coach rate limit of 60 tool calls per minute, stored in the same Postgres schema.
- PostHog server events per tool call with coach, tool, duration, outcome.

## Repository
- New public repo `easton-mcp`, the same conventions as the other Easton repos: semver tags, coherence specs, gitleaks pre-commit and CI, env only for every id, URL and key.
- One npm package, TypeScript, vitest.
- `easton-mcp.spec.md` at root with invariants: the served version equals the package version; every write tool declares `idempotency_key`; every tool declares a scope; no tool handler reads `process.env`.

## Environment
```
MCP_PUBLIC_URL            canonical server URL, the token audience
MCP_JWT_SIGNING_KEY       ed25519 private key
MCP_ALLOWED_REDIRECTS     https://claude.ai/api/mcp/auth_callback plus the two loopback forms
MCP_CIMD_HOSTS            claude.ai
MCP_ADMIN_GROUP           Google Group email for admins
GOOGLE_OAUTH_CLIENT_ID    Google login for coaches
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY        domain-wide delegation
GOOGLE_WORKSPACE_ADMIN_EMAIL
LEADERBOARD_SUPABASE_URL
LEADERBOARD_SUPABASE_PUBLISHABLE_KEY   leaderboard reads, RLS enforced
MCP_SUPABASE_URL
MCP_SUPABASE_SERVICE_ROLE_KEY          server state project only
POSTHOG_KEY
```

## Delivery phases
1. Auth and transport. Discovery endpoints, DCR, Google login, consent page, token issue and validation, `/health`. Gate: claude.ai connects and calls a `whoami` tool.
2. Leaderboard reads. Six tools, three resources, audit log. Gate: a coach answers three real questions in claude.ai with correct numbers checked against eastonpodium.com.
3. Docs reads. Jake grants the delegation scopes in the Workspace admin console, seeds the registry, three read tools ship. Gate: a coach reads one Doc and one Sheet they can open in Drive, and gets nothing for one they cannot.
4. Writes. `report_data_issue`, `add_comment`, `append_rows`, idempotency, admin gate. Gate: a repeated call returns the stored result and one audit row.

Future adapters in order: duals (Turso, read), Easton+ (Firestore, read, academy scoped), Mat Lab.

## Decided
1. Host: Vercel, one Hono function, hostname `mcp.eastontc.com`.
2. Document registry: Supabase table, admin tools to change it, no env allowlist.
3. Jake holds Workspace super admin and grants the service account scopes.
4. Server state lives in a new Supabase project `easton-mcp`. The server never holds a service role key for a product project.
5. v1 writes: `report_data_issue` and `add_comment` for coaches; `append_rows`, `register_document` and `remove_document` for admins.

## Open questions
1. The first documents to seed in the registry.

## Risks
- Domain-wide delegation grants the service account the right to impersonate any user in the domain. The private key is the most sensitive secret in the system. It lives in Vercel env only.
- Supabase RLS on leaderboard tables is the only read boundary. The `015` and later migrations enabled RLS on settings and sync tables; verify every table the adapter reads has a public select policy and nothing more.
- Token lifetime of one hour bounds a role change. Acceptable for v1.
- claude.ai callback URLs change over time. Keep them in env, not code.
