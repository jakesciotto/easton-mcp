import { describe, expect, it } from 'vitest'
import { exchange, obtainCode, redirect, register, resource, testApp } from './fixtures.js'
import { randomToken } from './tokens.js'

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
}

describe('a coach completes registration, google sign in, consent and the code exchange over http and then calls mcp', () => {
  it('holds', async () => {
    const app = testApp()
    const { client_id } = await register(app)
    const verifier = randomToken()
    const { code } = await obtainCode(app, client_id, verifier)
    const res = await exchange(app, {
      grant_type: 'authorization_code',
      client_id,
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      resource,
    })
    expect(res.status).toBe(200)
    const tokens = (await res.json()) as {
      access_token: string
      refresh_token: string
      scope: string
      token_type: string
    }
    expect(tokens.token_type).toBe('bearer')
    expect(tokens.scope).toBe('leaderboard:read docs:read')
    const mcp = await app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(initialize),
    })
    expect(mcp.status).toBe(200)
    const refreshed = await exchange(app, {
      grant_type: 'refresh_token',
      client_id,
      refresh_token: tokens.refresh_token,
    })
    expect(refreshed.status).toBe(200)
    const reused = await exchange(app, { grant_type: 'refresh_token', client_id, refresh_token: tokens.refresh_token })
    expect(reused.status).toBe(400)
    expect(((await reused.json()) as { error: string }).error).toBe('invalid_grant')
  })
})

describe('a denied consent returns the client to its redirect with access_denied and no code', () => {
  it('holds', async () => {
    const app = testApp()
    const { client_id } = await register(app)
    const { consentToken } = await obtainCode(app, client_id, randomToken())
    const back = await app.request('/oauth/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ consent: consentToken, decision: 'deny' }),
    })
    expect(back.status).toBe(302)
    const location = new URL(back.headers.get('location')!)
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('code')).toBeNull()
  })
})
