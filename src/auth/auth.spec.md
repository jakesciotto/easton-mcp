# Easton MCP auth
The OAuth 2.1 authorization server and resource server: discovery, client resolution, Google login, consent, token issue, token verification and the auth store.

## entrances
- route GET /.well-known/oauth-authorization-server: the authorization server metadata, for any client
  handler: authRoutes in routes.ts
  trust: internet
- route GET /.well-known/oauth-protected-resource: the protected resource metadata, for any client
  handler: authRoutes in routes.ts
  trust: internet
- route POST /oauth/register: dynamic client registration, for any client
  handler: authRoutes in routes.ts
  trust: internet
- route GET /oauth/authorize: the start of a login, from the coach's browser
  handler: authRoutes in routes.ts
  trust: internet
- route POST /oauth/authorize: the start of a login with form fields, from the coach's browser
  handler: authRoutes in routes.ts
  trust: internet
- route POST /oauth/token: the code exchange and the refresh, from the client
  handler: authRoutes in routes.ts
  trust: internet
- route POST /oauth/revoke: a token revocation, from the client
  handler: authRoutes in routes.ts
  trust: internet
- route GET /oauth/google/callback: Google's answer to the login, through the coach's browser
  handler: authRoutes in routes.ts
  trust: internet
- route POST /oauth/consent: the coach's allow or deny on the consent page
  handler: authRoutes in routes.ts
  trust: internet

## invariants
- resource metadata: The protected resource metadata names the mcp path as the resource and one issuer.
  over: the resource and issuer values derived from the public url
  via: the protected resource metadata names the mcp path as the resource and one issuer
  because: claude.ai finds the authorization server through this document, and a second issuer would let a client bind a token elsewhere
  refuted: the resource field names the issuer instead of the mcp path -> the test the protected resource metadata names the mcp path as the resource and one issuer went red (2026-10-22)
  kinds: none
- server metadata: The authorization server metadata advertises S256, the none auth method and CIMD support.
  over: the metadata fields claude.ai reads before it chooses CIMD over DCR
  via: the authorization server metadata advertises S256, the none auth method and CIMD support
  because: Claude prefers CIMD when the metadata advertises it, and the MCP adapter hardcodes a method the server does not use
  refuted: client_id_metadata_document_supported set to false -> the test the authorization server metadata advertises S256, the none auth method and CIMD support went red (2026-10-22)
  kinds: none
- bearer required: A request to mcp without a bearer token answers 401 with the resource metadata pointer.
  over: a request with no authorization header, a malformed header and a token that does not verify
  via: a request to mcp without a bearer token answers 401 with the resource metadata pointer
  because: the 401 with resource_metadata is how an MCP client starts the OAuth handshake, and no tool runs before a bearer verifies
  crossing: internet -> coach
  entrances: route POST /mcp
  refuted: the 401 challenge drops the resource_metadata pointer -> the test a request to mcp without a bearer token answers 401 with the resource metadata pointer went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization declared as audience bound token
  checklist: revalidated-permission dismissed: every request verifies the bearer again
  checklist: message-authenticity dismissed: the bearer is a JWT the server verifies under audience bound token
  checklist: encrypted-storage dismissed: a bearer is never stored
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists on a request
- redirect allowlist: A registered redirect must match an allowed https URI exactly or a loopback URI with the port ignored.
  over: every allowed entry, its scheme and path variants, http outside loopback, and a loopback with another port
  via: a registered redirect must match an allowed https URI exactly or a loopback URI with the port ignored
  because: a code sent to a redirect outside the allowlist is a stolen login, and native clients pick a free loopback port at run time
  crossing: internet -> coach
  entrances: none
  refuted: remove the port-ignored loopback branch in isAllowedRedirect -> the test a registered redirect must match an allowed https URI exactly or a loopback URI with the port ignored went red (2026-10-22)
  kinds: identity, output
  checklist: capability-authorization dismissed: a redirect carries no credential, the code it receives is bound by the login flow
  checklist: canonical-encoding dismissed: an https entry matches as an exact string and a loopback match reads only the host, so no normalization produces an identity
  checklist: destination-confinement declared as redirect allowlist
  checklist: redaction dismissed: a redirect carries no content to scrub
  checklist: commit-ordered-effects dismissed: the allowlist check has no effect of its own
  checklist: circuit-breaker-policy dismissed: no dependency is called
  checklist: declared-target-coverage dismissed: one redirect, one check
  checklist: identity-continuity dismissed: a client identity is not succeeded by another
- public clients: Dynamic registration stores a public client and refuses an unregistered redirect.
  over: a registration with an allowed redirect and one with a redirect outside the allowlist
  via: dynamic registration stores a public client and refuses an unregistered redirect
  because: DCR is the fallback for a client without a CIMD document, and it must never issue a confidential client
  crossing: internet -> state
  entrances: route POST /oauth/register
  refuted: registerClient stops checking the redirect against the allowlist -> the test dynamic registration stores a public client and refuses an unregistered redirect went red (2026-10-22)
  kinds: identity
  checklist: capability-authorization dismissed: registration issues no credential
  checklist: canonical-encoding dismissed: a client id is generated, never derived from the input
  checklist: identity-continuity dismissed: a registered client is not succeeded by another
- CIMD clients: A client id that is a CIMD url on an allowed host resolves to its document and is refused on another host or on a client id mismatch.
  over: a document on an allowed host, a document on another host, a document whose client_id differs, and a document without redirect uris
  via: a client id that is a CIMD url on an allowed host resolves to its document and is refused on another host or on a client id mismatch
  because: a CIMD client has no row, so the document is the whole client record, and a document on an unknown host could send a code anywhere
  crossing: internet -> state
  entrances: none
  refuted: resolveCimd stops comparing the document client_id with the client id -> the test a client id that is a CIMD url on an allowed host resolves to its document and is refused on another host or on a client id mismatch went red (2026-10-22)
  kinds: identity, output
  checklist: capability-authorization dismissed: resolution issues no credential
  checklist: canonical-encoding dismissed: the client id must equal the document's client_id exactly
  checklist: identity-continuity dismissed: a document is fetched fresh for one hour and not succeeded
  checklist: destination-confinement declared as CIMD clients
  checklist: redaction dismissed: the document holds public client metadata
  checklist: commit-ordered-effects dismissed: resolution has no effect of its own
  checklist: circuit-breaker-policy dismissed: a failed fetch refuses the client and opens no breaker
  checklist: declared-target-coverage dismissed: one document, one fetch
- google login: Google login accepts only a verified eastontc.com account whose nonce matches.
  over: an id token with the hosted domain, one without it, one with an unverified email, and one whose nonce differs
  via: google login accepts only a verified eastontc.com account whose nonce matches
  because: the server has no user table, so the hosted domain and the verified email are the whole membership check
  crossing: internet -> coach
  entrances: none
  refuted: exchange stops comparing the id token nonce -> the test google login accepts only a verified eastontc.com account whose nonce matches went red (2026-10-22)
  kinds: identity, message
  checklist: capability-authorization dismissed: the id token is accepted once and issues no bearer by itself
  checklist: canonical-encoding declared as google login
  checklist: identity-continuity dismissed: the subject is Google's and never reassigned here
  checklist: message-authenticity declared as google login
  checklist: destination-confinement dismissed: the login sends nothing onward
  checklist: input-validation dismissed: the claims are read after the signature verifies and no field enters storage
  checklist: retry-recognition dismissed: the login is one request and one answer
  checklist: duplicate-suppression dismissed: the nonce binds one answer to one request
  checklist: keyed-ordering dismissed: no queue carries the login
  checklist: acknowledgment-barrier dismissed: no queue carries the login
  checklist: retry-classification dismissed: a failed login is refused, never retried by the server
- audience bound token: An access token carries the server url as audience and is refused for another audience or after expiry.
  over: a token for the server audience, one for another audience, and one past its expiry
  via: an access token carries the server url as audience and is refused for another audience or after expiry
  because: a token minted for another resource must not open this one, and a token lives one hour so a lost token has a short life
  crossing: internet -> coach
  entrances: none
  refuted: verifyAccessToken stops checking the audience -> the test an access token carries the server url as audience and is refused for another audience or after expiry went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization declared as audience bound token
  checklist: revalidated-permission dismissed: the role travels inside the token for one hour and a refresh re-resolves it
  checklist: message-authenticity dismissed: the token is signed by the server and verified under this invariant
  checklist: encrypted-storage dismissed: an access token is never stored
  checklist: key-rotation-compatibility dismissed: one signing key, nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists on a request
- bound code: The login flow ends in a code bound to the client, the redirect and the pkce challenge.
  over: a full login whose code carries the client id, the redirect uri and the S256 challenge from the authorize request
  via: the login flow ends in a code bound to the client, the redirect and the pkce challenge
  because: a code that is not bound could be exchanged by another client or at another redirect
  crossing: internet -> coach
  entrances: none
  refuted: grantConsent stores the nonce as the code challenge -> the test the login flow ends in a code bound to the client, the redirect and the pkce challenge went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization declared as bound code
  checklist: revalidated-permission dismissed: a code lives five minutes and its exchange checks the binding
  checklist: message-authenticity dismissed: the consent token is signed by the server and verified under fresh login state
  checklist: encrypted-storage dismissed: a code is stored as its SHA-256 hash and the plain value is never persisted
  checklist: key-rotation-compatibility dismissed: a hash is not decrypted
  checklist: separation-of-duties dismissed: the coach approves their own login and no second approver exists
- code exchange: The code exchange refuses a wrong verifier, a used code and a foreign client.
  over: an exchange with the right verifier, a code taken twice, and a code from another client
  via: the code exchange refuses a wrong verifier, a used code and a foreign client
  because: PKCE is the only proof that the party exchanging the code started the login, and a code must burn on first use
  crossing: internet -> coach
  entrances: none
  refuted: exchangeAuthorizationCode stops comparing the code's client with the caller -> the test the code exchange refuses a wrong verifier, a used code and a foreign client went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization declared as code exchange
  checklist: revalidated-permission dismissed: the exchange follows the login within five minutes
  checklist: message-authenticity dismissed: no signed message is accepted here
  checklist: encrypted-storage dismissed: a code is stored as its hash
  checklist: key-rotation-compatibility dismissed: a hash is not decrypted
  checklist: separation-of-duties dismissed: no approval policy exists on an exchange
- refresh rotation: A refresh token rotates on use and a reused token revokes its family.
  over: a refresh with the live token, a second refresh with the rotated token, and a refresh with the token already rotated
  via: a refresh token rotates on use and a reused token revokes its family
  because: a refresh token presented after its rotation is the OAuth 2.1 reuse signal, and revoking the family limits a stolen token
  crossing: internet -> coach
  entrances: none
  refuted: a reused refresh token no longer revokes its family -> the test a refresh token rotates on use and a reused token revokes its family went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization declared as refresh rotation
  checklist: revalidated-permission declared as refresh revalidation
  checklist: message-authenticity dismissed: no signed message is accepted here
  checklist: encrypted-storage dismissed: a refresh token is stored as its hash
  checklist: key-rotation-compatibility dismissed: a hash is not decrypted
  checklist: separation-of-duties dismissed: no approval policy exists on a refresh
- refresh revalidation: A refresh re-resolves the role, keeps the family expiry and ends when the account is no longer allowed.
  over: a refresh after the role changed, a refresh near the family expiry, and a refresh for an account the resolver refuses
  via: a refresh re-resolves the role, keeps the family expiry and ends when the account is no longer allowed
  because: rotation must never extend a session past thirty days from sign in, and a removed coach must lose access at the next refresh
  crossing: internet -> coach
  entrances: none
  refuted: rotation sets a new thirty day expiry instead of keeping the family expiry -> the test a refresh re-resolves the role, keeps the family expiry and ends when the account is no longer allowed went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization declared as refresh rotation
  checklist: revalidated-permission declared as refresh revalidation
  checklist: message-authenticity dismissed: no signed message is accepted here
  checklist: encrypted-storage dismissed: a refresh token is stored as its hash
  checklist: key-rotation-compatibility dismissed: a hash is not decrypted
  checklist: separation-of-duties dismissed: no approval policy exists on a refresh
- group grants: A token carries only the consented scopes the coach Google Groups grant, and a group change applies at the next refresh.
  over: a coach in a granting group, a coach in no group, a member of the admin group, an account the directory no longer knows, and one coach joining, leaving and then losing the account across three refreshes
  via: a token carries only the consented scopes the coach Google Groups grant, and a group change applies at the next refresh
  because: Easton manages access in Google Workspace, so the scope_grants rows map a Google Group to a scope and the server never grants a scope on its own
  crossing: internet -> coach
  entrances: none
  refuted: grantedScopes returns every consented scope without the group filter -> the test a token carries only the consented scopes the coach Google Groups grant, and a group change applies at the next refresh went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization declared as group grants
  checklist: revalidated-permission declared as refresh revalidation
  checklist: message-authenticity dismissed: the groups come from the Directory API over TLS with a delegated token, and no signed message is accepted
  checklist: encrypted-storage dismissed: the refresh row keeps the consented scopes, and the granted set lives only in the one hour token
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: a grant row is data an admin writes, and no approval policy exists on a login
- directory groups: The directory client reads the groups of a coach as the workspace admin, across pages, and answers null for an unknown account.
  over: a coach whose groups span two pages, a coach in no group, and an account the directory answers 404 for
  via: the directory client reads the groups of a coach as the workspace admin, across pages, and answers null for an unknown account
  because: a group read needs an admin identity, a coach in many groups must not lose the later pages, and an unknown account must end its token family
  crossing: coach -> google
  entrances: none
  refuted: groupsOf returns after the first page -> the test the directory client reads the groups of a coach as the workspace admin, across pages, and answers null for an unknown account went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization declared as group grants
  checklist: revalidated-permission dismissed: the groups are read again at every login, code exchange and refresh
  checklist: message-authenticity dismissed: the server signs the assertion itself and accepts no signed message here
  checklist: encrypted-storage dismissed: the admin token is held in memory for one function instance and nothing persists
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists on a read
- fresh login state: A stale or tampered login state never reaches consent.
  over: a value that is no token, and a token of another kind presented as consent state
  via: a stale or tampered login state never reaches consent
  because: the login is stateless on the server, so the signed state is the only record of the pending request
  crossing: internet -> coach
  entrances: none
  refuted: verifyStateToken answers a consent payload when verification fails instead of null -> the test a stale or tampered login state never reaches consent went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization dismissed: the state token authorizes no resource, it carries the pending request
  checklist: revalidated-permission dismissed: the state lives ten minutes
  checklist: message-authenticity declared as fresh login state
  checklist: encrypted-storage dismissed: the state is signed, not stored
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists on a login
- whole flow: A coach completes registration, google sign in, consent and the code exchange over http and then calls mcp.
  over: the whole flow over http from registration to the first mcp call
  via: a coach completes registration, google sign in, consent and the code exchange over http and then calls mcp
  because: every other auth invariant holds a step alone, and only the whole flow proves the steps fit
  crossing: internet -> coach
  entrances: route POST /oauth/register, route GET /oauth/authorize, route GET /oauth/google/callback, route POST /oauth/consent, route POST /oauth/token, route POST /mcp
  refuted: the consent route answers allow with a denial so no code is issued -> the test a coach completes registration, google sign in, consent and the code exchange over http and then calls mcp went red (2026-10-22)
  kinds: none
- denied consent: A denied consent returns the client to its redirect with access_denied and no code.
  over: a consent answered deny
  via: a denied consent returns the client to its redirect with access_denied and no code
  because: a deny must end the login without a code, and the client must learn why
  crossing: internet -> coach
  entrances: route POST /oauth/consent
  refuted: denyConsent answers server_error instead of access_denied -> the test a denied consent returns the client to its redirect with access_denied and no code went red (2026-10-22)
  kinds: none
- tokens from the provider: An access token is minted only by the provider.
  protects: mintAccessToken
  chokepoint: eastonProvider
  from: anywhere
  because: the provider is the one place that resolves the role and scopes a token carries
  crossing: internet -> coach
  kinds: credential
  checklist: capability-authorization declared as audience bound token
  checklist: revalidated-permission dismissed: the token is minted once at login or refresh, and audience bound token checks it on every call
  checklist: message-authenticity dismissed: no signed message is accepted at this chokepoint
  checklist: encrypted-storage dismissed: nothing is persisted at this chokepoint
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists here
- guard issues the 401: The 401 with the resource metadata pointer is issued only by the bearer guard.
  protects: unauthorized
  chokepoint: requireBearer
  from: anywhere
  because: the guard is the one place a request is turned away before a bearer verifies, so every protected route sits behind it
  crossing: internet -> coach
  kinds: credential
  checklist: capability-authorization declared as bearer required
  checklist: revalidated-permission dismissed: the guard verifies the bearer on every request
  checklist: message-authenticity dismissed: no signed message is accepted at this chokepoint
  checklist: encrypted-storage dismissed: nothing is persisted at this chokepoint
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists here
- directory through the client: The server reaches the Directory groups endpoint only through the directory client.
  protects: DIRECTORY_GROUPS_URL
  chokepoint: googleDirectory
  from: anywhere
  because: the groups endpoint must be reached only with the workspace admin token, the field mask and the timeout the client sets
  crossing: coach -> google
  kinds: credential
  checklist: capability-authorization declared as directory groups
  checklist: revalidated-permission dismissed: the admin token lives one hour and every login, code exchange and refresh reads the groups again
  checklist: message-authenticity dismissed: no signed message is accepted at this chokepoint
  checklist: encrypted-storage dismissed: nothing is persisted at this chokepoint
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists here
