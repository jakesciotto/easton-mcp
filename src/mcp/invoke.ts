import type { AuditRow, AuthStore } from '../auth/store.js'
import { sha256 } from '../auth/tokens.js'
import type { Telemetry, ToolEvent } from '../telemetry/telemetry.js'
import type { Adapter, AuthContext, ResourceDef, ToolDef } from './registry.js'

export const RESULT_CAP = 50_000

export interface InvokeDeps {
  store: AuthStore
  telemetry: Telemetry
  now: () => number
}

type AuditBase = Omit<AuditRow, 'outcome' | 'durationMs' | 'result' | 'error'>
type AuditEntry = Pick<AuditRow, 'outcome' | 'durationMs'> & Partial<Pick<AuditRow, 'result' | 'error'>>

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, canonical(v)]),
    )
  }
  return value
}

export function textResult(result: unknown) {
  const text = JSON.stringify(result ?? null)
  if (text.length <= RESULT_CAP) return { content: [{ type: 'text' as const, text }] }
  return {
    content: [
      { type: 'text' as const, text: text.slice(0, RESULT_CAP) },
      { type: 'text' as const, text: JSON.stringify({ truncated: true }) },
    ],
  }
}

export function errorResult(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] }
}

export function deniedText(scope: string): string {
  return `scope ${scope} is required. Ask an Easton admin to add you to a Google Group that grants ${scope}; access starts at your next token refresh, within an hour.`
}

export function allowed(auth: AuthContext, scope: string): boolean {
  return scope === '' || auth.scopes.includes(scope)
}

function idempotencyKeyOf(input: unknown): string | null {
  const key = (input as { idempotency_key?: unknown }).idempotency_key
  return typeof key === 'string' && key.length > 0 ? key : null
}

function auditor(store: AuthStore, base: AuditBase) {
  return (entry: AuditEntry) => store.appendAudit({ result: null, error: null, ...base, ...entry })
}

export async function invokeTool(deps: InvokeDeps, adapter: Adapter, tool: ToolDef, auth: AuthContext, args: unknown) {
  const input = args ?? {}
  const write = !tool.annotations.readOnlyHint
  const idempotencyKey = idempotencyKeyOf(input)
  const observed = <T>(work: Promise<T>): Promise<T> =>
    work.catch(err => {
      deps.telemetry.exception(err, auth.subject)
      throw err
    })
  const audit = auditor(deps.store, {
    subject: auth.subject,
    clientId: null,
    tool: tool.name,
    inputHash: sha256(JSON.stringify(canonical(input))),
    input: write ? input : null,
    idempotencyKey,
  })
  const record = (entry: AuditEntry) => observed(audit(entry))
  const report = (event: Pick<ToolEvent, 'outcome' | 'durationMs' | 'replayed' | 'failure'>) =>
    deps.telemetry.tool(auth.subject, {
      tool: tool.name,
      adapter: adapter.name,
      scope: tool.scope,
      readOnly: !write,
      ...event,
    })
  if (!allowed(auth, tool.scope)) {
    await record({ outcome: 'denied', durationMs: 0, error: deniedText(tool.scope) })
    report({ outcome: 'denied', durationMs: 0 })
    return errorResult(deniedText(tool.scope))
  }
  if (write && !idempotencyKey) {
    await record({ outcome: 'error', durationMs: 0, error: 'idempotency_key is required' })
    report({ outcome: 'failed', durationMs: 0, failure: 'missing_idempotency_key' })
    return errorResult('idempotency_key is required')
  }
  if (write && idempotencyKey) {
    const prior = await observed(deps.store.findAudit(auth.subject, tool.name, idempotencyKey))
    if (prior) {
      await record({ outcome: 'replayed', durationMs: 0, result: prior.result })
      report({ outcome: 'completed', durationMs: 0, replayed: true })
      return textResult(prior.result)
    }
  }
  const started = deps.now()
  let result: unknown
  try {
    result = await tool.handler({ auth, input })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const durationMs = deps.now() - started
    deps.telemetry.exception(err, auth.subject)
    await record({ outcome: 'error', durationMs, error: message })
    report({ outcome: 'failed', durationMs, failure: 'execution_error' })
    return errorResult(message)
  }
  const durationMs = deps.now() - started
  try {
    await record({ outcome: 'ok', durationMs, result: write ? result : null })
  } catch (err) {
    if (!write) throw err
  }
  report({ outcome: 'completed', durationMs, replayed: false })
  return textResult(result)
}

export async function readResource(deps: InvokeDeps, resource: ResourceDef, auth: AuthContext, uri: URL) {
  const record = auditor(deps.store, {
    subject: auth.subject,
    clientId: null,
    tool: resource.uri,
    inputHash: sha256(JSON.stringify(uri.href)),
    input: null,
    idempotencyKey: null,
  })
  if (!allowed(auth, resource.scope)) {
    await record({ outcome: 'denied', durationMs: 0, error: deniedText(resource.scope) })
    throw new Error(deniedText(resource.scope))
  }
  const started = deps.now()
  const text = await resource.read({ auth })
  await record({ outcome: 'ok', durationMs: deps.now() - started })
  return { contents: [{ uri: uri.href, mimeType: resource.mimeType, text }] }
}
