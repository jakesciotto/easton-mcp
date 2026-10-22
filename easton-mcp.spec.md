# Easton MCP
A remote MCP server that gives Easton coaches, through claude.ai, read access to gym data and a small set of audited writes.

## trust levels
- internet: an MCP client or a browser on the public internet, before any bearer verifies
- coach: a bearer the server minted for a verified eastontc.com account, with its role and scopes
- state: the auth, audit and registry rows in the state project, reached with the service role key
- google: Google's token endpoint, Drive and the Directory API, reached through the service account as the coach, or as the workspace admin for group reads
- leaderboard: the easton-leaderboard Supabase project, read with its publishable key under Row Level Security

## entrances
- route GET /health: the version and the live adapters, for anyone
  handler: createApp in src/app.ts
  trust: internet
- route GET and DELETE /mcp: a method the app refuses with 405, for anyone
  handler: createApp in src/app.ts
  trust: internet
- script start: the Node process that serves the app outside Vercel
  handler: src/index.ts
  trust: internet
- function api/index: the Vercel function that serves every request in production
  handler: handler in api/index.ts
  trust: internet

## invariants
- version parity: The served version equals the package version.
  over: the VERSION constant and the package.json version
  via: the served version equals the package version
  because: a release tag, the package and the health route must name one version, so a deployed server can be matched to its tag
  refuted: set VERSION to '0.0.0' -> the test the served version equals the package version went red (2026-10-22)
  kinds: none
- health version: The health route reports the package version.
  over: the version field of the health answer against package.json
  via: the health route reports the package version
  because: the health route is how a deploy is checked against its tag from outside
  refuted: the health route answers the literal '0.0.0' as its version -> the test the health route reports the package version went red (2026-10-22)
  kinds: none
