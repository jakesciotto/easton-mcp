# easton-mcp: map for agents

Read `CLAUDE.md` for the conventions and `docs/design.md` for the design and the rationale by component. The rules live in the coherence specs: `easton-mcp.spec.md` at the root and one `*.spec.md` in each component folder under `src/`.

| Component | Folder | Spec |
| --- | --- | --- |
| Easton MCP | `.` | `easton-mcp.spec.md` |
| adapters | `src/adapters` | `src/adapters/adapters.spec.md` |
| docs adapter | `src/adapters/docs` | `src/adapters/docs/docs.spec.md` |
| leaderboard adapter | `src/adapters/leaderboard` | `src/adapters/leaderboard/leaderboard.spec.md` |
| auth | `src/auth` | `src/auth/auth.spec.md` |
| transport | `src/mcp` | `src/mcp/mcp.spec.md` |

`npx --no -- coherence spec --check` lists every invariant with its state. `npx --no -- coherence query status` lists the structural defects and the open requirements.
