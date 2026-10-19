# Easton MCP auth
The OAuth 2.1 authorization server and resource server: discovery, client resolution, Google login, consent, token issue, token verification and the auth store.

## invariants
- the protected resource metadata names the mcp path as the resource and one issuer
- the authorization server metadata advertises S256, the none auth method and CIMD support
- a request to mcp without a bearer token answers 401 with the resource metadata pointer
- a registered redirect must match an allowed https URI exactly or a loopback URI with the port ignored
- dynamic registration stores a public client and refuses an unregistered redirect
- a client id that is a CIMD url on an allowed host resolves to its document and is refused on another host or on a client id mismatch
- google login accepts only a verified eastontc.com account whose nonce matches
- an access token carries the server url as audience and is refused for another audience or after expiry
- the login flow ends in a code bound to the client, the redirect and the pkce challenge
- the code exchange refuses a wrong verifier, a used code and a foreign client
- a refresh token rotates on use and a reused token revokes its family
- a refresh re-resolves the role, keeps the family expiry and ends when the account is no longer allowed
- a stale or tampered login state never reaches consent
- a coach completes registration, google sign in, consent and the code exchange over http and then calls mcp
- a denied consent returns the client to its redirect with access_denied and no code

## works when
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

## why
The server is its own authorization server. claude.ai identifies itself with a Client ID Metadata Document or registers itself with Dynamic Client Registration, and Google offers neither. So the server publishes its own metadata and delegates only the login to Google.

CIMD comes before DCR because Claude prefers it when the metadata advertises support. A CIMD client id is a URL on an allowed host, so no row is created per connection. The fetch follows no redirect, reads at most 64 KB, and keeps only the redirect URIs that pass the same allowlist as DCR, so a document on an allowed host cannot send a code elsewhere. DCR stays as the fallback and issues public clients only. Because a CIMD client has no row, the code and refresh token tables carry the client id as plain text with no foreign key to the clients table (migration 0003); the first live consent from claude.ai failed on that key. Every client record carries the full scope list, because the adapter's authorize handler rejects a scope the client did not register and Claude's documents list none.

Loopback redirects ignore the port because native clients such as Claude Code pick a free port at run time (RFC 8252 section 7.3). Every other redirect must match an https entry exactly.

The login is stateless on the server. The authorize call signs the pending request into the Google state parameter, the Google callback verifies that state, exchanges the code, verifies the id token against Google's keys, and requires a verified email in the hosted domain plus the nonce from the state. The consent page carries a second signed token, and only the allow decision mints a code. Codes and refresh tokens are stored as SHA-256 hashes. The adapter's own PKCE check is switched off, so the exchange consumes the code in one atomic take and verifies S256 itself.

Access tokens are EdDSA JWTs with the server's mcp URL as audience, one hour long. Refresh tokens rotate on every use inside one Postgres function, so two concurrent refreshes cannot both win. A refresh token presented after its rotation revokes the whole family, which is the OAuth 2.1 reuse rule. The family keeps the expiry of its first token, thirty days from sign in, so rotation never extends a session; the coach signs in again. Every refresh re-resolves the role, and an account the resolver no longer allows loses its family at once. The token endpoint answers invalid_grant for every dead token, which is what Claude's client expects before it signs the coach in again. The exchange requires the redirect URI and consumes the code on any attempt, so a failed exchange also burns the code.

Two review findings stay open by choice. A replayed code is refused but does not revoke the tokens its first use issued; the code lives five minutes and its first use needed the PKCE verifier, which only the client holds. A consent token can mint more than one code inside its ten minutes; each code carries the same PKCE challenge, so nobody without the verifier can exchange one. Both become store-backed single use if the audit log ever shows a replay.

The role is resolved at login by an injected function. Phase 1 resolves every coach to coach. Phase 3 adds the Directory API group check for admin.

## refutations
- a registered redirect must match an allowed https URI exactly or a loopback URI with the port ignored: remove the port-ignored branch -> RED
- a refresh token rotates on use and a reused token revokes its family: drop the rotatedAt check in exchangeRefreshToken -> RED
