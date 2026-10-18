import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import type { Context } from 'hono'
import type { z } from 'zod'
import type { AuthEnv } from '../auth/routes.js'
import type { AuditRow, AuthStore } from '../auth/store.js'
import { sha256 } from '../auth/tokens.js'

export interface AuthContext {
  subject: string
  role: 'coach' | 'admin'
  scopes: string[]
}

export interface ToolDef {
  name: string
  description: string
  scope: string
  inputSchema: z.ZodType
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
  }
  handler(ctx: { auth: AuthContext; input: unknown }): Promise<unknown>
}

export interface ResourceDef {
  uri: string
  name: string
  scope: string
  mimeType: string
  read(ctx: { auth: AuthContext }): Promise<string>
}

export interface Adapter {
  name: string
  tools: ToolDef[]
  resources: ResourceDef[]
  health(): Promise<boolean>
}

export const RESULT_CAP = 50_000

function canonical(value: unknown): unknown {
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

function textResult(result: unknown) {
  const text = JSON.stringify(result ?? null)
  if (text.length <= RESULT_CAP) return { content: [{ type: 'text' as const, text }] }
  return {
    content: [
      { type: 'text' as const, text: text.slice(0, RESULT_CAP) },
      { type: 'text' as const, text: JSON.stringify({ truncated: true }) },
    ],
  }
}

function allowed(auth: AuthContext, scope: string): boolean {
  return scope === '' || auth.scopes.includes(scope)
}

export function createMcpHandler(deps: {
  adapters: Adapter[]
  store: AuthStore
  now?: () => number
  version: string
}) {
  const now = deps.now ?? Date.now
  return async (c: Context<AuthEnv>): Promise<Response> => {
    const auth = c.get('auth')
    const server = new McpServer({ name: 'easton-mcp', version: deps.version })
    const audit = (base: Omit<AuditRow, 'outcome' | 'durationMs' | 'result' | 'error'>) =>
      (row: Pick<AuditRow, 'outcome' | 'durationMs'> & Partial<Pick<AuditRow, 'result' | 'error'>>) =>
        deps.store.appendAudit({ result: null, error: null, ...base, ...row })
    const denied = (scope: string) => ({ isError: true, content: [{ type: 'text' as const, text: `scope ${scope} is required` }] })
    for (const adapter of deps.adapters) {
      for (const tool of adapter.tools) {
        const write = !tool.annotations.readOnlyHint
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
          async (args: unknown) => {
            const input = args ?? {}
            const key = (input as { idempotency_key?: unknown }).idempotency_key
            const idempotencyKey = typeof key === 'string' && key.length > 0 ? key : null
            const record = audit({
              subject: auth.subject,
              clientId: null,
              tool: tool.name,
              inputHash: sha256(JSON.stringify(canonical(input))),
              input: write ? input : null,
              idempotencyKey,
            })
            if (!allowed(auth, tool.scope)) {
              await record({ outcome: 'denied', durationMs: 0, error: `scope ${tool.scope} is required` })
              return denied(tool.scope)
            }
            if (write && !idempotencyKey) {
              await record({ outcome: 'error', durationMs: 0, error: 'idempotency_key is required' })
              return { isError: true, content: [{ type: 'text' as const, text: 'idempotency_key is required' }] }
            }
            if (write && idempotencyKey) {
              const prior = await deps.store.findAudit(auth.subject, tool.name, idempotencyKey)
              if (prior) {
                await record({ outcome: 'replayed', durationMs: 0, result: prior.result })
                return textResult(prior.result)
              }
            }
            const started = now()
            let result: unknown
            try {
              result = await tool.handler({ auth, input })
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              await record({ outcome: 'error', durationMs: now() - started, error: message })
              return { isError: true, content: [{ type: 'text' as const, text: message }] }
            }
            try {
              await record({ outcome: 'ok', durationMs: now() - started, result: write ? result : null })
            } catch (err) {
              if (!write) throw err
            }
            return textResult(result)
          },
        )
      }
      for (const resource of adapter.resources) {
        server.registerResource(resource.name, resource.uri, { mimeType: resource.mimeType }, async uri => {
          const record = audit({
            subject: auth.subject,
            clientId: null,
            tool: resource.uri,
            inputHash: sha256(JSON.stringify(uri.href)),
            input: null,
            idempotencyKey: null,
          })
          if (!allowed(auth, resource.scope)) {
            await record({ outcome: 'denied', durationMs: 0, error: `scope ${resource.scope} is required` })
            throw new Error(`scope ${resource.scope} is required`)
          }
          const started = now()
          const text = await resource.read({ auth })
          await record({ outcome: 'ok', durationMs: now() - started })
          return { contents: [{ uri: uri.href, mimeType: resource.mimeType, text }] }
        })
      }
    }
    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return (await transport.handleRequest(c)) ?? c.body(null, 204)
  }
}
