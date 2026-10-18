# easton-mcp

A remote MCP server for Easton coaches. It serves leaderboard and document data to claude.ai
through thin adapters and a small set of audited writes. The design is in `docs/design.md`.

Dev: `npm run dev` serves on port 8787. Check it with `curl localhost:8787/health`.

Test: `npm test`. Gates: `npm run lint`, `npm run typecheck`, `npm run build`.

Deploy: Vercel, one function at `api/index.ts`. Set `NODEJS_HELPERS=0` in the project env.
Use Node 22 and npm 11 for installs, because npm 10 fails to resolve this tree.

## Environment

| Variable | Meaning |
| --- | --- |
| MCP_PUBLIC_URL | Canonical server URL. The resource is this URL plus `/mcp`, and it is the token audience. |
| MCP_JWT_SIGNING_KEY | Ed25519 private key in PKCS8 PEM that signs access and state tokens. |
| MCP_ALLOWED_REDIRECTS | Comma list: the claude.ai callback plus `http://localhost/callback` and `http://127.0.0.1/callback`. |
| MCP_CIMD_HOSTS | Comma list of hosts allowed to serve a Client ID Metadata Document. |
| MCP_ADMIN_GROUP | Google Group email whose members are admins. |
| GOOGLE_OAUTH_CLIENT_ID | Google login client for coaches. Redirect URI is the public URL plus `/oauth/google/callback`. |
| GOOGLE_OAUTH_CLIENT_SECRET | Secret of that client. |
| GOOGLE_SERVICE_ACCOUNT_EMAIL | Service account with domain-wide delegation. Phase 3. |
| GOOGLE_PRIVATE_KEY | Private key of that service account. Phase 3. |
| GOOGLE_WORKSPACE_ADMIN_EMAIL | Admin the service account impersonates for Directory reads. Phase 3. |
| LEADERBOARD_SUPABASE_URL | Leaderboard project URL. Phase 2. |
| LEADERBOARD_SUPABASE_PUBLISHABLE_KEY | Leaderboard publishable key. RLS stays enforced. Phase 2. |
| MCP_SUPABASE_URL | Server state project URL. |
| MCP_SUPABASE_SERVICE_ROLE_KEY | Server state project service role key. Never a product project key. |
| POSTHOG_KEY | PostHog project key for tool call events. Phase 2. |

Generate the signing key with `openssl genpkey -algorithm ed25519` and paste the PEM with literal `\n` line breaks.
