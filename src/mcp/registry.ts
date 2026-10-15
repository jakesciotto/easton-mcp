import type { Hono } from 'hono'
import type { z } from 'zod'

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
  mimeType: string
  read(ctx: { auth: AuthContext }): Promise<string>
}

export interface Adapter {
  name: string
  tools: ToolDef[]
  resources: ResourceDef[]
  health(): Promise<boolean>
}

export function mountAdapters(app: Hono, adapters: Adapter[]): void {
  void app
  void adapters
  throw new Error('not implemented')
}
