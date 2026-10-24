import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { AppOptions } from '../app.js'
import { bearerFor, fakeGoogle, testConfig, testKeys } from '../auth/fixtures.js'
import { memoryStore } from '../auth/store.js'
import { sha256 } from '../auth/tokens.js'
import { telemetryConfigFromEnv } from './config.js'
import { telemetry } from './telemetry.js'
import type { TelemetrySink, ToolEvent } from './telemetry.js'

const SUBJECT = 'coach@eastontc.com'

function appWith(sink: TelemetrySink, extra: Partial<AppOptions> = {}) {
  const deferred: Promise<unknown>[] = []
  const app = createApp({
    config: testConfig,
    store: memoryStore(),
    keys: testKeys,
    google: fakeGoogle,
    telemetry: sink,
    defer: work => deferred.push(work),
    ...extra,
  })
  return { app, deferred }
}

async function callWhoami(app: ReturnType<typeof createApp>) {
  const token = await bearerFor(app)
  const client = new Client({ name: 'test', version: '0' })
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.eastontc.com/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => Promise.resolve(app.request(input instanceof Request ? input.url : String(input), init)),
  })
  await client.connect(transport)
  return client.callTool({ name: 'whoami', arguments: {} })
}

describe('a telemetry failure never fails a tool call or a response', () => {
  it('holds', async () => {
    const broken: TelemetrySink = {
      tool() {
        throw new Error('capture down')
      },
      exception() {
        throw new Error('capture down')
      },
      flush: () => Promise.reject(new Error('flush down')),
    }
    const { app, deferred } = appWith(broken)
    const res = await callWhoami(app)
    expect(res.isError).toBeFalsy()
    expect(JSON.parse((res.content as { text: string }[])[0].text)).toMatchObject({ subject: SUBJECT })
    expect(deferred.length).toBeGreaterThan(0)
    await expect(Promise.all(deferred)).resolves.toBeDefined()

    const failing = appWith(broken, {
      verify: () => Promise.reject(new Error('verifier down')),
    })
    const crash = await failing.app.request('/mcp', { method: 'POST', headers: { authorization: 'Bearer x' } })
    expect(crash.status).toBe(500)
    expect(await crash.json()).toEqual({ error: { code: 'server_error', message: 'internal error' } })

    const slow = appWith({ ...broken, flush: () => new Promise(() => {}) })
    const health = await slow.app.request('/health')
    expect(health.status).toBe(200)
    expect(slow.deferred).toHaveLength(1)

    const throwingDefer = appWith(broken, {
      defer: () => {
        throw new Error('defer down')
      },
    })
    expect((await throwingDefer.app.request('/health')).status).toBe(200)

    const warnings: string[] = []
    const hanging = telemetry({ ...broken, flush: () => new Promise(() => {}) }, m => warnings.push(m), 10)
    await expect(hanging.flush()).resolves.toBeUndefined()
    expect(warnings).toEqual(['telemetry flush failed: telemetry flush took longer than 10 ms'])
  })
})

describe('telemetry names a coach by a hash of the subject and never by the email', () => {
  it('holds', async () => {
    const tools: { distinctId: string; event: ToolEvent }[] = []
    const exceptions: (string | undefined)[] = []
    const recording: TelemetrySink = {
      tool: (distinctId, event) => tools.push({ distinctId, event }),
      exception: (_error, distinctId) => exceptions.push(distinctId),
      flush: async () => {},
    }
    const { app } = appWith(recording)
    await callWhoami(app)
    expect(tools).toEqual([
      {
        distinctId: sha256(SUBJECT),
        event: {
          tool: 'whoami',
          adapter: 'core',
          scope: '',
          readOnly: true,
          outcome: 'completed',
          durationMs: expect.any(Number),
          replayed: false,
        },
      },
    ])
    expect(JSON.stringify(tools)).not.toContain('@')

    const errors: Error[] = []
    const sink = telemetry({
      ...recording,
      exception: (error, distinctId) => {
        errors.push(error as Error)
        exceptions.push(distinctId)
      },
    })
    sink.exception(new Error(`directory read failed for ${SUBJECT}`), SUBJECT)
    expect(exceptions).toEqual([sha256(SUBJECT)])
    expect(errors[0].message).toBe('directory read failed for [email]')
    expect(errors[0].stack).not.toContain(SUBJECT)
  })
})

describe('telemetry turns on only for a project token and an https host and stays off otherwise', () => {
  it('holds', () => {
    const warnings: string[] = []
    const warn = (m: string) => warnings.push(m)
    expect(
      telemetryConfigFromEnv({ POSTHOG_KEY: 'phc_abc', POSTHOG_HOST: 'https://us.i.posthog.com/path' }, warn),
    ).toEqual({
      key: 'phc_abc',
      host: 'https://us.i.posthog.com',
    })
    expect(telemetryConfigFromEnv({}, warn)).toBeNull()
    expect(warnings).toEqual([])
    const off = [
      { POSTHOG_KEY: 'phc_abc' },
      { POSTHOG_HOST: 'https://us.i.posthog.com' },
      { POSTHOG_KEY: 'phx_personal', POSTHOG_HOST: 'https://us.i.posthog.com' },
      { POSTHOG_KEY: 'phc_abc', POSTHOG_HOST: 'http://us.i.posthog.com' },
      { POSTHOG_KEY: 'phc_abc', POSTHOG_HOST: 'not a url' },
    ]
    for (const env of off) expect(telemetryConfigFromEnv(env, warn)).toBeNull()
    expect(warnings).toHaveLength(off.length)
  })
})
