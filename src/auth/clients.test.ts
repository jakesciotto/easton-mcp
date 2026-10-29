import { describe, expect, it } from 'vitest'
import { clientsStore, isAllowedRedirect } from './clients.js'
import { testApp, testConfig } from './fixtures.js'
import { memoryStore } from './store.js'

const allowed = testConfig.allowedRedirects

describe('a registered redirect must match an allowed https URI exactly or a loopback URI with the port ignored', () => {
  it('accepts every allowed entry and refuses its scheme and path variants', () => {
    for (const entry of allowed) {
      const url = new URL(entry)
      expect(isAllowedRedirect(entry, allowed), entry).toBe(true)
      expect(isAllowedRedirect(`${entry}/x`, allowed), `${entry}/x`).toBe(false)
      const swapped = new URL(entry)
      swapped.protocol = url.protocol === 'https:' ? 'http:' : 'https:'
      expect(isAllowedRedirect(swapped.href, allowed), swapped.href).toBe(false)
      if (url.protocol === 'http:') {
        const ported = new URL(entry)
        ported.port = '49152'
        expect(isAllowedRedirect(ported.href, allowed), ported.href).toBe(true)
      }
    }
  })

  it('decides the documented cases', () => {
    expect(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback', allowed)).toBe(true)
    expect(isAllowedRedirect('http://localhost:3118/callback', allowed)).toBe(true)
    expect(isAllowedRedirect('http://127.0.0.1:49152/callback', allowed)).toBe(true)
    expect(isAllowedRedirect('http://localhost:3118/other', allowed)).toBe(false)
    expect(isAllowedRedirect('https://evil.example/cb', allowed)).toBe(false)
    expect(isAllowedRedirect('http://claude.ai/api/mcp/auth_callback', allowed)).toBe(false)
  })
})

describe('dynamic registration stores a public client and refuses an unregistered redirect', () => {
  const store = memoryStore()
  const app = testApp({ store })
  const post = (body: unknown) =>
    app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('registers an allowed redirect as a public client', async () => {
    const res = await post({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'client_secret_post',
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.token_endpoint_auth_method).toBe('none')
    expect(body.client_secret).toBeUndefined()
    const row = await store.getClient(body.client_id as string)
    expect(row?.source).toBe('dcr')
    expect(row?.clientSecretHash).toBeNull()
  })

  it('refuses an unregistered redirect', async () => {
    const res = await post({ redirect_uris: ['https://evil.example/cb'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client_metadata')
  })
})

describe('a client id that is a CIMD url on an allowed host resolves to its document and is refused on another host or on a client id mismatch', () => {
  const id = 'https://claude.ai/oauth/client.json'
  const calls: string[] = []
  const doc = (client_id: string) => ({
    client_id,
    client_name: 'Claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  })
  const fakeFetch = (body: unknown) =>
    (async (url: string | URL | Request) => {
      calls.push(String(url))
      return Response.json(body)
    }) as typeof fetch
  const build = (body: unknown) => clientsStore({ store: memoryStore(), config: testConfig, fetch: fakeFetch(body) })

  it('resolves the document on an allowed host and stores it', async () => {
    const store = memoryStore()
    const clients = clientsStore({ store, config: testConfig, fetch: fakeFetch(doc(id)) })
    const info = await clients.getClient(id)
    expect(info?.client_id).toBe(id)
    expect(info?.redirect_uris).toEqual(['https://claude.ai/api/mcp/auth_callback'])
    expect(await store.getClient(id)).toBeNull()
  })

  it('keeps only the allowed redirect uris from the document and refuses a document with none', async () => {
    const mixed = {
      client_id: id,
      redirect_uris: [
        'https://evil.example/cb',
        'http://localhost/callback',
        'https://claude.ai/api/mcp/auth_callback',
      ],
    }
    expect((await build(mixed).getClient(id))?.redirect_uris).toEqual([
      'http://localhost/callback',
      'https://claude.ai/api/mcp/auth_callback',
    ])
    expect(await build({ client_id: id, redirect_uris: ['https://evil.example/cb'] }).getClient(id)).toBeUndefined()
  })

  it('refuses another host without fetching', async () => {
    calls.length = 0
    const other = 'https://evil.example/client.json'
    expect(await build(doc(other)).getClient(other)).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('refuses a client id mismatch', async () => {
    expect(await build(doc('https://claude.ai/other.json')).getClient(id)).toBeUndefined()
  })

  it('refuses a document without redirect uris', async () => {
    expect(await build({ client_id: id, redirect_uris: [] }).getClient(id)).toBeUndefined()
  })

  it('caches a resolved document for one hour', async () => {
    calls.length = 0
    let t = 0
    const clients = clientsStore({
      store: memoryStore(),
      config: testConfig,
      fetch: fakeFetch(doc(id)),
      now: () => t,
    })
    await clients.getClient(id)
    await clients.getClient(id)
    expect(calls).toHaveLength(1)
    t = 3_600_001
    await clients.getClient(id)
    expect(calls).toHaveLength(2)
  })
})
