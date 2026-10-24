import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../app.js'
import { bearerFor, fakeGoogle, testConfig, testKeys } from '../auth/fixtures.js'
import { memoryStore } from '../auth/store.js'
import type { Adapter } from './registry.js'
import { createMcpHandler } from './registry.js'
import { Hono } from 'hono'
import type { AuthEnv } from '../auth/routes.js'

const probe: Adapter = {
  name: 'probe',
  tools: [
    {
      name: 'docs_write',
      title: 'Docs write',
      description: 'Write a doc.',
      scope: 'docs:write',
      inputSchema: z.object({ idempotency_key: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async () => ({ written: true }),
    },
    {
      name: 'big',
      title: 'Big',
      description: 'Return a long text.',
      scope: 'docs:read',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async () => 'x'.repeat(60_000),
    },
  ],
  resources: [
    {
      uri: 'easton://probe/secret',
      name: 'secret',
      scope: 'docs:write',
      mimeType: 'text/plain',
      read: async () => 'secret',
    },
  ],
  health: async () => true,
}

async function connect(
  app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> },
  token: string,
) {
  const client = new Client({ name: 'test', version: '0' })
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.eastontc.com/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => Promise.resolve(app.request(input instanceof Request ? input.url : String(input), init)),
  })
  await client.connect(transport)
  return client
}

function withProbe(scopes = ['leaderboard:read', 'docs:read']) {
  const store = memoryStore()
  const app = createApp({ config: testConfig, store, keys: testKeys, google: fakeGoogle })
  const outer = new Hono<AuthEnv>()
  outer.use('/mcp', async (c, next) => {
    c.set('auth', { subject: 'coach@eastontc.com', role: 'coach', scopes })
    await next()
  })
  outer.post('/mcp', createMcpHandler({ adapters: [probe], store, version: '9.9.9' }))
  return { app, outer, store }
}

describe('an initialize request with a valid bearer answers the server name and version and a tools list names whoami', () => {
  it('holds', async () => {
    const { app } = withProbe()
    const client = await connect(app, await bearerFor(app))
    expect(client.getServerVersion()).toMatchObject({ name: 'easton-mcp', version: '0.1.0' })
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name)).toContain('whoami')
    const about = await client.readResource({ uri: 'easton://about' })
    expect(about.contents[0]).toMatchObject({ mimeType: 'text/plain' })
  })
})

describe('whoami answers the subject, role and scopes of the bearer and writes one audit row', () => {
  it('holds', async () => {
    const { app, store } = withProbe()
    const client = await connect(app, await bearerFor(app))
    const res = await client.callTool({ name: 'whoami', arguments: {} })
    const content = res.content as { type: string; text: string }[]
    expect(JSON.parse(content[0].text)).toEqual({
      subject: 'coach@eastontc.com',
      role: 'coach',
      scopes: ['leaderboard:read', 'docs:read'],
      version: '0.1.0',
    })
    const rows = store.audit()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      subject: 'coach@eastontc.com',
      tool: 'whoami',
      outcome: 'ok',
      input: null,
      result: null,
    })
    expect(rows[0].inputHash).toMatch(/^[\w-]{43}$/)
  })
})

describe('a tool call outside the bearer scopes is denied and audited as denied', () => {
  it('holds', async () => {
    const { outer, store } = withProbe()
    const client = await connect(outer, 'unused')
    const res = await client.callTool({ name: 'docs_write', arguments: { idempotency_key: 'k1' } })
    expect(res.isError).toBe(true)
    expect((res.content as { text: string }[])[0].text).toMatch(
      /^scope docs:write is required\. Ask an Easton admin to add you to a Google Group that grants docs:write/,
    )
    expect(store.audit()).toHaveLength(1)
    expect(store.audit()[0]).toMatchObject({ tool: 'docs_write', outcome: 'denied', idempotencyKey: 'k1' })
  })
})

describe('a write tool requires an idempotency key and replays the stored result on a repeat', () => {
  it('holds', async () => {
    const { outer, store } = withProbe(['docs:write'])
    const client = await connect(outer, 'unused')
    const missing = await client.callTool({ name: 'docs_write', arguments: {} })
    expect(missing.isError).toBe(true)
    const first = await client.callTool({ name: 'docs_write', arguments: { idempotency_key: 'k1' } })
    const again = await client.callTool({ name: 'docs_write', arguments: { idempotency_key: 'k1' } })
    expect((again.content as { text: string }[])[0].text).toBe((first.content as { text: string }[])[0].text)
    expect(store.audit().map(r => r.outcome)).toEqual(['error', 'ok', 'replayed'])
  })
})

describe('a resource read outside the bearer scopes is denied and audited as denied', () => {
  it('holds', async () => {
    const { outer, store } = withProbe()
    const client = await connect(outer, 'unused')
    await expect(client.readResource({ uri: 'easton://probe/secret' })).rejects.toThrow(/scope docs:write is required/)
    expect(store.audit()).toMatchObject([{ tool: 'easton://probe/secret', outcome: 'denied' }])
    const ok = await connect(withProbe(['docs:write']).outer, 'unused')
    expect((await ok.readResource({ uri: 'easton://probe/secret' })).contents[0]).toMatchObject({ text: 'secret' })
  })
})

describe('a tool result longer than the cap is truncated and marked', () => {
  it('holds', async () => {
    const { outer, store } = withProbe()
    const client = await connect(outer, 'unused')
    const res = await client.callTool({ name: 'big', arguments: {} })
    const content = res.content as { text: string }[]
    expect(content).toHaveLength(2)
    expect(content[0].text).toHaveLength(50_000)
    expect(JSON.parse(content[1].text)).toEqual({ truncated: true })
    expect(store.audit()[0]).toMatchObject({ tool: 'big', outcome: 'ok' })
  })
})
