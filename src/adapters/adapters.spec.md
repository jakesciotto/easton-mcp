# Easton MCP adapters

One folder per product. Each folder exports one Adapter from its `index.ts` and keeps its tools, resources and prompts in sub folders, one file each.

## invariants

## works when

- typechecks

## why
Planned invariant, anchored at the registry mount once a second adapter ships: an adapter folder exports exactly one Adapter and the registry contract never changes for a new product.


Auth and transport stay fixed while products join. The registry enforces scope, audit and the output cap for every tool, so an adapter file holds only its schema, its query and its output shape. Order of arrival: leaderboard, docs, duals, plus, matlab.

## refutations
