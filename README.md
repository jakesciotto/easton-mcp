# easton-mcp

A remote MCP server for Easton coaches. It serves leaderboard and document data to claude.ai
through thin adapters and a small set of audited writes. The design is in `docs/design.md`.

## Connect

Server URL: `https://mcp.eastontc.com/mcp`

Sign in with your eastontc.com Google account. Your Google Groups decide what you can read.

**Claude Code.** Run this once in a terminal:

```
claude mcp add --transport http --scope user easton https://mcp.eastontc.com/mcp
```

Then start Claude Code, type `/mcp`, pick easton and choose Authenticate.

**Claude Desktop and claude.ai.** Both use the same connector list.

1. Open Settings, then Connectors, then Add custom connector.
2. Name it Easton and paste the server URL. Leave the other fields empty.
3. Click Connect and sign in.

**ChatGPT.** You need a plan that allows developer mode.

1. Open Settings, then Apps and Connectors, then Advanced, and turn on Developer mode.
2. Click Create. Name it Easton, paste the server URL and choose OAuth.
3. Click Create and sign in.

## Development

Dev: `npm run dev` serves on port 8787. Check it with `curl localhost:8787/health`.

Test: `npm test`. Gates: `npm run lint`, `npm run typecheck`, `npm run build`.

Deploy: Vercel, one function at `api/index.ts`. Set `NODEJS_HELPERS=0` in the project env. `vercel.json` sets the framework to null, because the Hono preset builds a second function from `src/app.ts` that crashes on `/`; `public/` holds the static output Vercel requires. The classifier blocks `vercel deploy --prod` and Supabase migrations from a session, so Jake runs both.
Use Node 22 and npm 11 for installs, because npm 10 fails to resolve this tree.

## Environment

| Variable | Meaning |
| --- | --- |
| MCP_PUBLIC_URL | Canonical server URL. The resource is this URL plus `/mcp`, and it is the token audience. |
| MCP_JWT_SIGNING_KEY | Ed25519 private key in PKCS8 PEM that signs access and state tokens. |
| MCP_ALLOWED_REDIRECTS | Comma list: the claude.ai callback, `https://chatgpt.com/connector_platform_oauth_redirect`, `http://localhost/callback` and `http://127.0.0.1/callback`. |
| MCP_CIMD_HOSTS | Comma list of hosts allowed to serve a Client ID Metadata Document: `claude.ai,chatgpt.com`. |
| MCP_ADMIN_GROUP | Google Group email whose members get the admin role. Scopes come from the `scope_grants` table, not from this group. |
| GOOGLE_OAUTH_CLIENT_ID | Google login client for coaches. Redirect URI is the public URL plus `/oauth/google/callback`. |
| GOOGLE_OAUTH_CLIENT_SECRET | Secret of that client. |
| GOOGLE_SERVICE_ACCOUNT_EMAIL | Service account with domain-wide delegation on `drive.readonly` and `admin.directory.group.readonly`. Optional: the docs adapter mounts only when both values exist. |
| GOOGLE_PRIVATE_KEY | Private key of that service account, PEM with literal `\n` line breaks. |
| GOOGLE_WORKSPACE_ADMIN_EMAIL | Workspace admin the service account impersonates to read a coach's Google Groups. Without it, a coach gets only the scopes the `*` rows grant. |
| LEADERBOARD_SUPABASE_URL | Leaderboard project URL. Optional: the leaderboard adapter mounts only when both leaderboard values exist. |
| LEADERBOARD_SUPABASE_PUBLISHABLE_KEY | Leaderboard publishable key, so RLS applies. The server refuses a secret or service role key at boot. |
| MCP_SUPABASE_URL | Server state project URL. |
| MCP_SUPABASE_SERVICE_ROLE_KEY | Server state project service role key. Never a product project key. |
| POSTHOG_KEY | PostHog project token (`phc_`) for tool events, exceptions and logs. Optional: telemetry is off unless both PostHog values exist. |
| POSTHOG_HOST | PostHog ingest origin, for example `https://us.i.posthog.com`. Must use https. |

Generate the signing key with `openssl genpkey -algorithm ed25519` and paste the PEM with literal `\n` line breaks.

## Access

A coach's scopes are the scopes the client asks for, cut down to what the `scope_grants` table grants the coach's Google Groups. A row with the group `*` grants a scope to every signed in account. The server reads the groups at sign in and at every token refresh, so a group change applies within an hour. Groups are direct memberships only; a nested group does not count. Add a grant in the state project:

```sql
insert into public.scope_grants (group_email, scope, added_by)
values ('kids-coaches@eastontc.com', 'docs:read', 'you@eastontc.com');
```
