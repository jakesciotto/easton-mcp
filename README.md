# easton-mcp

A remote MCP server for Easton coaches. It serves leaderboard and document data to claude.ai
through thin adapters and a small set of audited writes. The design is in `docs/design.md`.

Dev: `npm run dev` serves on port 8787. Check it with `curl localhost:8787/health`.

Test: `npm test`. Gates: `npm run lint`, `npm run typecheck`, `npm run build`.

Deploy: Vercel, one function at `api/index.ts`. Set `NODEJS_HELPERS=0` in the project env.
Use Node 22 and npm 11 for installs, because npm 10 fails to resolve this tree.
