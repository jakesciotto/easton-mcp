import { generateKeyPairSync } from 'node:crypto'
import { expect } from 'vitest'
import { createApp } from '../app.js'
import type { AppOptions } from '../app.js'
import type { AuthConfig } from './config.js'
import { authConfigFromEnv } from './config.js'
import type { GoogleLogin } from './google.js'
import { memoryStore } from './store.js'
import { randomToken, sha256 } from './tokens.js'
import type { SigningKeys } from './tokens.js'

export const testConfig: AuthConfig = authConfigFromEnv({
  MCP_PUBLIC_URL: 'https://mcp.eastontc.com',
  MCP_ALLOWED_REDIRECTS: 'https://claude.ai/api/mcp/auth_callback,http://localhost/callback,http://127.0.0.1/callback',
  MCP_CIMD_HOSTS: 'claude.ai',
  MCP_ADMIN_GROUP: 'admins@eastontc.com',
})

export const testKeys: SigningKeys = (() => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { privateKey, publicKey }
})()

export const fakeGoogle: GoogleLogin = {
  authorizeUrl: (state, nonce) => `https://google.test/auth?state=${encodeURIComponent(state)}&nonce=${nonce}`,
  exchange: async code => (code === 'good' ? { email: 'coach@eastontc.com', name: 'Coach' } : null),
}

export function testApp(overrides: Partial<AppOptions> = {}) {
  return createApp({ config: testConfig, store: memoryStore(), keys: testKeys, google: fakeGoogle, ...overrides })
}

export type App = ReturnType<typeof testApp>

export const redirect = 'https://claude.ai/api/mcp/auth_callback'
export const resource = 'https://mcp.eastontc.com/mcp'

export async function register(app: App) {
  const res = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { client_id: string }
}

export async function obtainCode(app: App, clientId: string, verifier: string) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: sha256(verifier),
    code_challenge_method: 'S256',
    scope: 'leaderboard:read docs:read',
    state: 's1',
    resource,
  })
  const toGoogle = await app.request(`/oauth/authorize?${params}`)
  expect(toGoogle.status).toBe(302)
  const state = new URL(toGoogle.headers.get('location')!).searchParams.get('state')!
  const consent = await app.request(`/oauth/google/callback?state=${encodeURIComponent(state)}&code=good`)
  expect(consent.status).toBe(200)
  const html = await consent.text()
  expect(html).toContain('coach@eastontc.com')
  expect(html).toContain('claude.ai')
  const token = /name="consent" value="([^"]+)"/.exec(html)![1]
  const back = await app.request('/oauth/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ consent: token, decision: 'allow' }),
  })
  expect(back.status).toBe(302)
  const location = new URL(back.headers.get('location')!)
  expect(location.origin + location.pathname).toBe(redirect)
  expect(location.searchParams.get('state')).toBe('s1')
  return { code: location.searchParams.get('code')!, consentToken: token }
}

export async function exchange(app: App, body: Record<string, string>) {
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
}

export async function bearerFor(app: App): Promise<string> {
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
  return ((await res.json()) as { access_token: string }).access_token
}
