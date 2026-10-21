# Easton MCP adapters

One folder per product. Each folder exports one Adapter from its `index.ts` and keeps its tools, resources and prompts in sub folders, one file each.

## invariants

## works when

- typechecks

## why
Planned invariant, anchored at the registry mount once a second adapter ships: an adapter folder exports exactly one Adapter and the registry contract never changes for a new product.


Auth and transport stay fixed while products join. The registry enforces scope, audit and the output cap for every tool, so an adapter file holds only its schema, its query and its output shape. Order of arrival: docs search for the SOP set, then leaderboard, then duals, plus and matlab. Tools are task tools under a shared prefix per adapter, take names or arrays of names, and make one data round trip per call, so a common coach question costs at most two tool calls.

## refutations
