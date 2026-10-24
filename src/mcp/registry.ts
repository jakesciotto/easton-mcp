import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import type { Context } from 'hono'
import type { z } from 'zod'
import type { AuthEnv } from '../auth/routes.js'
import type { AuthStore } from '../auth/store.js'
import { noSink, telemetry } from '../telemetry/telemetry.js'
import type { Telemetry } from '../telemetry/telemetry.js'
import { invokeTool, readResource } from './invoke.js'

export interface AuthContext {
  subject: string
  role: 'coach' | 'admin'
  scopes: string[]
}

export interface ToolDef {
  name: string
  title: string
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

export { RESULT_CAP } from './invoke.js'

export function createMcpHandler(deps: {
  adapters: Adapter[]
  store: AuthStore
  telemetry?: Telemetry
  now?: () => number
  version: string
}) {
  const invoke = { store: deps.store, telemetry: deps.telemetry ?? telemetry(noSink), now: deps.now ?? Date.now }
  return async (c: Context<AuthEnv>): Promise<Response> => {
    const auth = c.get('auth')
    const server = new McpServer({ name: 'easton-mcp', version: deps.version })
    for (const adapter of deps.adapters) {
      for (const tool of adapter.tools) {
        server.registerTool(
          tool.name,
          { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
          (args: unknown) => invokeTool(invoke, adapter, tool, auth, args),
        )
      }
      for (const resource of adapter.resources) {
        server.registerResource(resource.name, resource.uri, { mimeType: resource.mimeType }, uri =>
          readResource(invoke, resource, auth, uri),
        )
      }
    }
    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return (await transport.handleRequest(c)) ?? c.body(null, 204)
  }
}
