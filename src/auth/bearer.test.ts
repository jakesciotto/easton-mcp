import { describe, expect, it } from 'vitest'
import { testApp } from './fixtures.js'

const challenge =
  'Bearer resource_metadata="https://mcp.eastontc.com/.well-known/oauth-protected-resource/mcp", scope="leaderboard:read docs:read leaderboard:write docs:write"'

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
}

const verify = async (token: string) =>
  token === 'good' ? { subject: 'coach@eastontc.com', role: 'coach' as const, scopes: [] } : null

describe('a request to mcp without a bearer token answers 401 with the resource metadata pointer', () => {
  const app = testApp({ verify })

  it.each([
    ['no header', {}],
    ['a non bearer scheme', { authorization: 'Basic abc' }],
    ['a rejected token', { authorization: 'Bearer bad' }],
  ])('answers 401 for %s', async (_name, headers) => {
    const res = await app.request('/mcp', { method: 'POST', headers })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(challenge)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('passes a verified token to the mcp handler and answers 405 to GET and DELETE', async () => {
    const ok = await app.request('/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer good', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initialize),
    })
    expect(ok.status).toBe(200)
    expect((await app.request('/mcp')).status).toBe(405)
    expect((await app.request('/mcp', { method: 'DELETE' })).status).toBe(405)
  })
})
