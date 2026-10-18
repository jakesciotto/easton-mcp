# Easton MCP transport
The stateless Streamable HTTP endpoint behind the bearer guard, the adapter registry with scope enforcement and audit rows, and the built-in core adapter.

## invariants
- an initialize request with a valid bearer answers the server name and version and a tools list names whoami
- whoami answers the subject, role and scopes of the bearer and writes one audit row
- a tool call outside the bearer scopes is denied and audited as denied
- a tool result longer than the cap is truncated and marked
- a write tool requires an idempotency key and replays the stored result on a repeat
- a resource read outside the bearer scopes is denied and audited as denied

## works when
- typechecks
- boundary "an initialize request with a valid bearer answers the server name and version and a tools list names whoami" at createMcpHandler via guard "an initialize request with a valid bearer answers the server name and version and a tools list names whoami"
- boundary "whoami answers the subject, role and scopes of the bearer and writes one audit row" at createMcpHandler via guard "whoami answers the subject, role and scopes of the bearer and writes one audit row"
- boundary "a tool call outside the bearer scopes is denied and audited as denied" at createMcpHandler via guard "a tool call outside the bearer scopes is denied and audited as denied"
- boundary "a tool result longer than the cap is truncated and marked" at createMcpHandler via guard "a tool result longer than the cap is truncated and marked"
- boundary "a write tool requires an idempotency key and replays the stored result on a repeat" at createMcpHandler via guard "a write tool requires an idempotency key and replays the stored result on a repeat"
- boundary "a resource read outside the bearer scopes is denied and audited as denied" at createMcpHandler via guard "a resource read outside the bearer scopes is denied and audited as denied"
- passes test "an initialize request with a valid bearer answers the server name and version and a tools list names whoami"
- passes test "whoami answers the subject, role and scopes of the bearer and writes one audit row"
- passes test "a tool call outside the bearer scopes is denied and audited as denied"
- passes test "a tool result longer than the cap is truncated and marked"

## why
Each request builds its own server and transport, because Vercel functions share nothing between calls. The transport runs stateless with JSON responses, so no session id exists to lose.

The registry enforces scope, not the tool. A tool declares one scope and the registry checks it against the bearer before the handler runs. A tool with the empty scope is open to every signed in coach, and whoami uses it.

Every tool call writes one audit row, whether it succeeds, fails or is denied. The row keeps the input and result only for tools that write.

Outputs are capped at 50,000 characters, well under Claude's 150,000 character limit. A longer result is cut and followed by a block that marks it truncated.

A write tool must carry an idempotency key. The registry looks the key up in the audit log before the handler runs and replays the stored result on a repeat, so a retried write never lands twice. The audit row for a successful write is written after the handler, outside its error path, and a failed audit write after a successful write still returns the result, because the write already happened. A resource carries a scope like a tool and every read writes an audit row.

## refutations
- a tool call outside the bearer scopes is denied and audited as denied: skip the scope check -> RED
