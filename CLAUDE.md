# CLAUDE.md

Context for agents working in this repository. The coherence specs hold the rules. Read
`easton-mcp.spec.md` and `docs/design.md` before you change code.

## Conventions

1. A release tag is semver. It equals the `package.json` version and the `VERSION` constant in `src/app.ts`. CI fails when they disagree.
2. Release from `main` only.
3. Secrets live in env only. Never commit `.env`. gitleaks runs as the pre-commit hook and in CI.
4. The coherence specs are the source of the rules. Run `npx --no -- coherence spec --check` and `npx --no -- coherence run` before you offer a branch.
5. Write prose in the STE100 style: short, active sentences. No em dashes, no emoji.
6. Run npm with Node 22 first on PATH. Use npm 11 to change the lockfile.

## Coherence

The project runs `@posthog/coherence` 1.x. The grammar is in `node_modules/@posthog/coherence/docs/spec.md` and the config keys are in `docs/config.md` beside it.

1. Every spec bullet is one invariant. A totality oracle names a vitest `describe` title in `via:`. A chokepoint names the protected symbol in `protects:` and the one symbol every reference passes through in `chokepoint:`.
2. Append a whole bullet after another bullet's last line. A bullet inserted between a bullet and its `refuted:`, `kinds:` or `checklist:` lines takes them.
3. Witness a totality oracle with `npx --no -- coherence refute <folder>/<name> --broke "<what you changed>"` while the break is staged. Then restore the code and run `npx --no -- coherence run`.
4. Record a choice with `npx --no -- coherence decide "<chose>" --over "<rejected>" --because "<why>" --session <id> --agent <name>`.
5. The rationale that the 0.37 specs carried in prose lives in `docs/design.md` under Rationale by component.
6. The 0.37 journal and work orders are kept under `.coherence/archive-0.37` as history. Coherence 1.x does not read them.
