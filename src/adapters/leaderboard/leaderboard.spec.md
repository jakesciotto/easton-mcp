# Easton MCP leaderboard adapter
Phase 2. Reads easton-leaderboard through the publishable key so RLS applies, returns persisted columns only, and files data issues as the one coach write.

## invariants

## works when
- typechecks

## why
Planned invariants, each anchored at its tool once the tool exists: the adapter reads persisted ranking columns and never recomputes a rank or an ERP; every tool requires a leaderboard scope and none reads with the service role; a list tool pages with a cursor and never returns more than one hundred rows; report_data_issue requires an idempotency key and stamps the signed in coach as the reporter.

The leaderboard owns its math. The adapter is a thin read surface over the same publishable key the public site uses, so a coach through Claude sees exactly what the site shows. The one write lands in a data_issues table the leaderboard project owns with its own RLS, and admins accept or reject it there.

Layout: `client.ts` holds the config and the Supabase client, `tools/` holds one file per tool that exports a factory taking the client, `resources/` holds one file per resource, `prompts/` holds one file per prompt once the registry mounts prompts. `index.ts` only assembles the lists.

The adapter mounts in `app.ts` only when both leaderboard env values exist, so the server boots without them and `/health` lists the adapters that are live.

## refutations
