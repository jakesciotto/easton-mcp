# Easton MCP transport
The stateless Streamable HTTP endpoint behind the bearer guard, the adapter registry with scope enforcement and audit rows, and the built-in core adapter.

## entrances
- route POST /mcp: an MCP request from claude.ai or another client, behind the bearer guard
  handler: createMcpHandler in registry.ts
  guard: requireBearer
  trust: internet

## invariants
- initialize: An initialize request with a valid bearer answers the server name and version and a tools list names whoami.
  over: an initialize request and a tools list request with a valid bearer
  via: an initialize request with a valid bearer answers the server name and version and a tools list names whoami
  because: initialize is the first call every client makes, and whoami is the one tool every coach can call
  refuted: the McpServer announces the name easton instead of easton-mcp -> the test an initialize request with a valid bearer answers the server name and version and a tools list names whoami went red (2026-10-22)
  kinds: none
- whoami: whoami answers the subject, role and scopes of the bearer and writes one audit row.
  over: a whoami call with a valid bearer
  via: whoami answers the subject, role and scopes of the bearer and writes one audit row
  because: whoami is the phase 1 gate, and the audit row is the proof that the registry wraps every tool
  crossing: coach -> state
  entrances: none
  refuted: whoami omits the role from its answer -> the test whoami answers the subject, role and scopes of the bearer and writes one audit row went red (2026-10-22)
  kinds: read
  checklist: scoped-reads dismissed: whoami reads the bearer and no table
  checklist: redaction dismissed: the subject, role and scopes are the coach's own
- scope enforcement: A tool call outside the bearer scopes is denied and audited as denied.
  over: every tool the adapters register, called with a bearer that lacks its scope
  via: a tool call outside the bearer scopes is denied and audited as denied
  because: the registry enforces scope before the handler runs, so a tool file holds only its schema, its query and its output shape
  crossing: coach -> state
  entrances: none
  refuted: skip the scope check for tools in createMcpHandler -> the test a tool call outside the bearer scopes is denied and audited as denied went red (2026-10-22)
  kinds: credential, read
  checklist: scoped-reads declared as scope enforcement
  checklist: capability-authorization declared as scope enforcement
  checklist: revalidated-permission dismissed: the scopes travel in the bearer, and a refresh re-resolves them
  checklist: message-authenticity dismissed: the bearer is verified before the handler
  checklist: encrypted-storage dismissed: the audit row holds no credential
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: redaction dismissed: the audit row keeps input and result only for a write
  checklist: separation-of-duties dismissed: no approval policy exists on a tool call
- result cap: A tool result longer than the cap is truncated and marked.
  over: a result longer than 50,000 characters
  via: a tool result longer than the cap is truncated and marked
  because: Claude's context limit sits at 150,000 characters, and a cut result must say it was cut
  refuted: the truncation marker says truncated false -> the test a tool result longer than the cap is truncated and marked went red (2026-10-22)
  kinds: output
  checklist: destination-confinement dismissed: the result returns to the caller and follows no hop
  checklist: redaction dismissed: the cut is by length, not by content
  checklist: commit-ordered-effects dismissed: the cap changes no effect
  checklist: circuit-breaker-policy dismissed: no breaker exists on a result
  checklist: declared-target-coverage dismissed: one result, one caller
- idempotent writes: A write tool requires an idempotency key and replays the stored result on a repeat.
  over: a write call without a key, with a new key, and with a key already in the audit log
  via: a write tool requires an idempotency key and replays the stored result on a repeat
  because: a retry with the same key replays the stored result instead of running the handler again, and the audit log is the one record of what landed
  crossing: coach -> state
  entrances: none
  refuted: the replay lookup searches a different idempotency key so a repeat is never found -> the test a write tool requires an idempotency key and replays the stored result on a repeat went red (2026-10-22)
  kinds: message
  checklist: destination-confinement dismissed: the result returns to the caller
  checklist: message-authenticity dismissed: the bearer is verified before the handler
  checklist: input-validation dismissed: each tool validates its own input schema
  checklist: retry-recognition declared as idempotent writes
  checklist: duplicate-suppression declared as idempotent writes
  checklist: keyed-ordering dismissed: no transport orders the calls
  checklist: acknowledgment-barrier dismissed: the audit row for a write lands after the handler and a failed audit still returns the result
  checklist: retry-classification dismissed: the client retries, the server replays
- resource scope: A resource read outside the bearer scopes is denied and audited as denied.
  over: every resource the adapters register, read with a bearer that lacks its scope
  via: a resource read outside the bearer scopes is denied and audited as denied
  because: a resource carries a scope like a tool, and the registry is the one place that checks it
  crossing: coach -> state
  entrances: none
  refuted: skip the scope check for resource reads in createMcpHandler -> the test a resource read outside the bearer scopes is denied and audited as denied went red (2026-10-22)
  kinds: credential, read
  checklist: scoped-reads declared as resource scope
  checklist: capability-authorization declared as resource scope
  checklist: revalidated-permission dismissed: the scopes travel in the bearer, and a refresh re-resolves them
  checklist: message-authenticity dismissed: the bearer is verified before the handler
  checklist: encrypted-storage dismissed: the audit row holds no credential
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: redaction dismissed: a resource read keeps no result in the audit row
  checklist: separation-of-duties dismissed: no approval policy exists on a read
