# Easton MCP
A remote MCP server that gives Easton coaches, through claude.ai, read access to gym data and a small set of audited writes.

## invariants
- the served version equals the package version

## works when
- typechecks
- boundary "the served version equals the package version" at VERSION via guard "the served version equals the package version"
- passes test "the health route reports the package version"
- coherence.config.json exists at root
- CHANGELOG.md exists at root
- docs/design.md exists at root

## why
Easton MCP is one Hono function on Vercel. Coaches reach it from claude.ai over Streamable HTTP.
It owns no domain data. Each product stays the source of truth behind a thin adapter, and a new
product attaches without a change to auth or transport.

The server is its own OAuth 2.1 authorization server, because claude.ai needs Dynamic Client
Registration and Google does not offer it. Coaches sign in with an eastontc.com Google account.
The server issues a one hour JWT with the coach's role and scopes, and validates it on every call.
Leaderboard reads use the publishable key, so Row Level Security always applies.

Every write is explicit, idempotent and audited. A write carries an idempotency key and the server
returns the stored result on a repeat. Every call writes one audit row. A write never calls a
product's sync, scrape or settings path, and admin writes act only on registered documents.

A release is a semver tag that equals the package version and the VERSION constant. Releases come
from main only. Secrets live in env only, gitleaks runs in the pre-commit hook and in CI, and the
coherence specs are the source of the rules.

## refutations
- the served version equals the package version: set VERSION to '0.0.0' -> RED
