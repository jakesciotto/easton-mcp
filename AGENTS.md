# easton-mcp — map for agents

> Generated from the spec tree by the coherence harness. Do not edit by hand.

A remote MCP server that gives Easton coaches, through claude.ai, read access to gym data and a small set of audited writes.

## Components

### Easton MCP  `.`
A remote MCP server that gives Easton coaches, through claude.ai, read access to gym data and a small set of audited writes.

_why:_ Easton MCP is one Hono function on Vercel. Coaches reach it from claude.ai over Streamable HTTP. It owns no domain data. Each product stays the source of truth behind a thin adapter, and a new product attaches without a change to auth or transport. The server is its own OAuth 2.1 authorization server, because claude.ai needs Dynamic Client Registration and Google does not offer it. Coaches sign in with an eastontc.com Google account. The server issues a one hour JWT with the coach's role and scopes, and validates it on every call. Leaderboard reads use the publishable key, so Row Level Security always applies. Every write is explicit, idempotent and audited. A write carries an idempotency key and the server returns the stored result on a repeat. Every call writes one audit row. A write never calls a product's sync, scrape or settings path, and admin writes act only on registered documents. A release is a semver tag that equals the package version and the VERSION constant. Releases come from main only. Secrets live in env only, gitleaks runs in the pre-commit hook and in CI, and the coherence specs are the source of the rules.

_works when:_
- typechecks
- boundary "the served version equals the package version" at VERSION via guard "the served version equals the package version"
- passes test "the health route reports the package version"
- passes test "a request to mcp without a bearer token answers 401 with the resource metadata pointer"
- coherence.config.json exists at root
- CHANGELOG.md exists at root
- docs/design.md exists at root

_files:_ `index.ts`, `app.test.ts`, `app.ts`, `bootstrap.ts`, `index.ts`, `vitest.config.ts`

### Easton MCP auth  `src/auth`
The OAuth 2.1 authorization server and resource server: discovery, client resolution, Google login, consent, token issue, token verification and the auth store.

_why:_ The server is its own authorization server. claude.ai identifies itself with a Client ID Metadata Document or registers itself with Dynamic Client Registration, and Google offers neither. So the server publishes its own metadata and delegates only the login to Google. CIMD comes before DCR because Claude prefers it when the metadata advertises support. A CIMD client id is a URL on an allowed host, so no row is created per connection. The fetch follows no redirect, reads at most 64 KB, and keeps only the redirect URIs that pass the same allowlist as DCR, so a document on an allowed host cannot send a code elsewhere. DCR stays as the fallback and issues public clients only. Every client record carries the full scope list, because the adapter's authorize handler rejects a scope the client did not register and Claude's documents list none. Loopback redirects ignore the port because native clients such as Claude Code pick a free port at run time (RFC 8252 section 7.3). Every other redirect must match an https entry exactly. The login is stateless on the server. The authorize call signs the pending request into the Google state parameter, the Google callback verifies that state, exchanges the code, verifies the id token against Google's keys, and requires a verified email in the hosted domain plus the nonce from the state. The consent page carries a second signed token, and only the allow decision mints a code. Codes and refresh tokens are stored as SHA-256 hashes. The adapter's own PKCE check is switched off, so the exchange consumes the code in one atomic take and verifies S256 itself. Access tokens are EdDSA JWTs with the server's mcp URL as audience, one hour long. Refresh tokens rotate on every use inside one Postgres function, so two concurrent refreshes cannot both win. A refresh token presented after its rotation revokes the whole family, which is the OAuth 2.1 reuse rule. The family keeps the expiry of its first token, thirty days from sign in, so rotation never extends a session; the coach signs in again. Every refresh re-resolves the role, and an account the resolver no longer allows loses its family at once. The token endpoint answers invalid_grant for every dead token, which is what Claude's client expects before it signs the coach in again. The exchange requires the redirect URI and consumes the code on any attempt, so a failed exchange also burns the code. Two review findings stay open by choice. A replayed code is refused but does not revoke the tokens its first use issued; the code lives five minutes and its first use needed the PKCE verifier, which only the client holds. A consent token can mint more than one code inside its ten minutes; each code carries the same PKCE challenge, so nobody without the verifier can exchange one. Both become store-backed single use if the audit log ever shows a replay. The role is resolved at login by an injected function. Phase 1 resolves every coach to coach. Phase 3 adds the Directory API group check for admin.

_works when:_
- typechecks
- passes test "the protected resource metadata names the mcp path as the resource and one issuer"
- passes test "the authorization server metadata advertises S256, the none auth method and CIMD support"
- passes test "a request to mcp without a bearer token answers 401 with the resource metadata pointer"
- boundary "a registered redirect must match an allowed https URI exactly or a loopback URI with the port ignored" at isAllowedRedirect via test "a registered redirect must match an allowed https URI exactly or a loopback URI with the port ignored"
- boundary "the protected resource metadata names the mcp path as the resource and one issuer" at protectedResourceMetadata via guard "the protected resource metadata names the mcp path as the resource and one issuer"
- boundary "the authorization server metadata advertises S256, the none auth method and CIMD support" at authorizationServerMetadata via guard "the authorization server metadata advertises S256, the none auth method and CIMD support"
- boundary "a request to mcp without a bearer token answers 401 with the resource metadata pointer" at requireBearer via guard "a request to mcp without a bearer token answers 401 with the resource metadata pointer"
- boundary "dynamic registration stores a public client and refuses an unregistered redirect" at clientsStore via guard "dynamic registration stores a public client and refuses an unregistered redirect"
- boundary "a client id that is a CIMD url on an allowed host resolves to its document and is refused on another host or on a client id mismatch" at clientsStore via guard "a client id that is a CIMD url on an allowed host resolves to its document and is refused on another host or on a client id mismatch"
- passes test "dynamic registration stores a public client and refuses an unregistered redirect"
- passes test "a client id that is a CIMD url on an allowed host resolves to its document and is refused on another host or on a client id mismatch"
- boundary "google login accepts only a verified eastontc.com account whose nonce matches" at googleLogin via guard "google login accepts only a verified eastontc.com account whose nonce matches"
- boundary "an access token carries the server url as audience and is refused for another audience or after expiry" at verifyAccessToken via guard "an access token carries the server url as audience and is refused for another audience or after expiry"
- boundary "the login flow ends in a code bound to the client, the redirect and the pkce challenge" at eastonProvider via guard "the login flow ends in a code bound to the client, the redirect and the pkce challenge"
- boundary "the code exchange refuses a wrong verifier, a used code and a foreign client" at eastonProvider via guard "the code exchange refuses a wrong verifier, a used code and a foreign client"
- boundary "a refresh token rotates on use and a reused token revokes its family" at eastonProvider via guard "a refresh token rotates on use and a reused token revokes its family"
- boundary "a refresh re-resolves the role, keeps the family expiry and ends when the account is no longer allowed" at eastonProvider via guard "a refresh re-resolves the role, keeps the family expiry and ends when the account is no longer allowed"
- boundary "a stale or tampered login state never reaches consent" at eastonProvider via guard "a stale or tampered login state never reaches consent"
- boundary "a coach completes registration, google sign in, consent and the code exchange over http and then calls mcp" at authRoutes via guard "a coach completes registration, google sign in, consent and the code exchange over http and then calls mcp"
- boundary "a denied consent returns the client to its redirect with access_denied and no code" at authRoutes via guard "a denied consent returns the client to its redirect with access_denied and no code"

_files:_ `bearer.test.ts`, `clients.test.ts`, `clients.ts`, `config.test.ts`, `config.ts`, `consent.ts`, `fixtures.ts`, `flow.test.ts`, `google.test.ts`, `google.ts`, `index.ts`, `metadata.test.ts`, `metadata.ts`, `provider.test.ts`, `provider.ts`, `routes.ts`, `store.test.ts`, `store.ts`, `tokens.ts`

### Easton MCP transport  `src/mcp`
The stateless Streamable HTTP endpoint behind the bearer guard, the adapter registry with scope enforcement and audit rows, and the built-in core adapter.

_why:_ Each request builds its own server and transport, because Vercel functions share nothing between calls. The transport runs stateless with JSON responses, so no session id exists to lose. The registry enforces scope, not the tool. A tool declares one scope and the registry checks it against the bearer before the handler runs. A tool with the empty scope is open to every signed in coach, and whoami uses it. Every tool call writes one audit row, whether it succeeds, fails or is denied. The row keeps the input and result only for tools that write. Outputs are capped at 50,000 characters, well under Claude's 150,000 character limit. A longer result is cut and followed by a block that marks it truncated. A write tool must carry an idempotency key. The registry looks the key up in the audit log before the handler runs and replays the stored result on a repeat, so a retried write never lands twice. The audit row for a successful write is written after the handler, outside its error path, and a failed audit write after a successful write still returns the result, because the write already happened. A resource carries a scope like a tool and every read writes an audit row.

_works when:_
- typechecks
- boundary "an initialize request with a valid bearer answers the server name and version and a tools list names whoami" at createMcpHandler via guard "an initialize request with a valid bearer answers the server name and version and a tools list names whoami"
- boundary "whoami answers the subject, role and scopes of the bearer and writes one audit row" at createMcpHandler via guard "whoami answers the subject, role and scopes of the bearer and writes one audit row"
- boundary "a tool call outside the bearer scopes is denied and audited as denied" at createMcpHandler via guard "a tool call outside the bearer scopes is denied and audited as denied"
- boundary "a tool result longer than the cap is truncated and marked" at createMcpHandler via guard "a tool result longer than the cap is truncated and marked"
- boundary "a write tool requires an idempotency key and replays the stored result on a repeat" at createMcpHandler via guard "a write tool requires an idempotency key and replays the stored result on a repeat"
- boundary "a resource read outside the bearer scopes is denied and audited as denied" at createMcpHandler via guard "a resource read outside the bearer scopes is denied and audited as denied"
- passes test "an initialize request with a valid bearer answers the server name and version and a tools list names whoami"
- passes test "whoami answers the subject, role and scopes of the bearer and writes one audit row"
- passes test "a tool call outside the bearer scopes is denied and audited as denied"
- passes test "a tool result longer than the cap is truncated and marked"

_files:_ `builtin.ts`, `mcp.test.ts`, `registry.ts`

## Structure

```
easton-mcp/
├─ api/
│  └─ index.ts
├─ src/
│  ├─ auth/  ●
│  │  ├─ bearer.test.ts
│  │  ├─ clients.test.ts
│  │  ├─ clients.ts
│  │  ├─ config.test.ts
│  │  ├─ config.ts
│  │  ├─ consent.ts
│  │  ├─ fixtures.ts
│  │  ├─ flow.test.ts
│  │  ├─ google.test.ts
│  │  ├─ google.ts
│  │  ├─ index.ts
│  │  ├─ metadata.test.ts
│  │  ├─ metadata.ts
│  │  ├─ provider.test.ts
│  │  ├─ provider.ts
│  │  ├─ routes.ts
│  │  ├─ store.test.ts
│  │  ├─ store.ts
│  │  └─ tokens.ts
│  ├─ mcp/  ●
│  │  ├─ builtin.ts
│  │  ├─ mcp.test.ts
│  │  └─ registry.ts
│  ├─ app.test.ts
│  ├─ app.ts
│  ├─ bootstrap.ts
│  └─ index.ts
└─ vitest.config.ts
```

