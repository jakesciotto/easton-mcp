import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { testConfig } from './fixtures.js'
import type { GoogleLogin } from './google.js'
import { memoryGrants, groupAccess } from './grants.js'
import { eastonProvider } from './provider.js'
import { memoryStore } from './store.js'
import type { Role } from './store.js'
import { mintAccessToken, randomToken, sha256, verifyAccessToken } from './tokens.js'

const keys = (() => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { privateKey, publicKey }
})()

const client: OAuthClientInformationFull = {
  client_id: 'client-a',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  token_endpoint_auth_method: 'none',
}
const other: OAuthClientInformationFull = { ...client, client_id: 'client-b' }

const google: GoogleLogin = {
  authorizeUrl: (state, nonce) => `https://google.test/auth?state=${state}&nonce=${nonce}`,
  exchange: async (code, nonce) =>
    code === 'good' ? { email: `coach+${nonce.length}@eastontc.com`, name: 'Coach' } : null,
}

const ALL = testConfig.scopes.filter(s => s !== 'offline_access')

function setup(now = () => Date.parse('2026-10-15T20:00:00Z'), roles = new Map<string, Role | null>()) {
  const config = testConfig
  const store = memoryStore(now)
  const provider = eastonProvider({
    config,
    store,
    clients: { getClient: async id => (id === client.client_id ? client : undefined) },
    keys,
    google,
    resolveAccess: async (email: string) => {
      const role = roles.has(email) ? roles.get(email)! : 'coach'
      return role ? { role, scopes: ALL } : null
    },
    now,
  })
  return { config, store, provider, roles }
}
const back = client.redirect_uris[0]

async function login(p: ReturnType<typeof setup>, verifier = randomToken()) {
  const res = { redirect: '' }
  const c = {
    redirect: (url: string) => {
      res.redirect = url
      return new Response(null, { status: 302, headers: { location: url } })
    },
    res: new Response(),
  }
  await p.provider.authorize(
    client,
    { codeChallenge: sha256(verifier), redirectUri: client.redirect_uris[0], scopes: ['leaderboard:read'], state: 'xyz' },
    c as never,
  )
  const state = new URL(res.redirect).searchParams.get('state')!
  const done = await p.provider.completeLogin(state, 'good')
  const location = await p.provider.grantConsent(done!.consentToken)
  const code = new URL(location!).searchParams.get('code')!
  return { code, verifier, state: new URL(location!).searchParams.get('state'), iss: new URL(location!).searchParams.get('iss') }
}

describe('an access token carries the server url as audience and is refused for another audience or after expiry', () => {
  it('holds', async () => {
    const config = testConfig
    const now = () => Date.parse('2026-10-15T20:00:00Z')
    const signer = { keys, issuer: config.issuer, audience: config.resourceUrl, now }
    const token = await mintAccessToken(signer, { subject: 'a@eastontc.com', role: 'coach', scopes: ['docs:read'], clientId: 'c' })
    expect(await verifyAccessToken(signer, token)).toMatchObject({ subject: 'a@eastontc.com', role: 'coach', scopes: ['docs:read'] })
    expect(await verifyAccessToken({ ...signer, audience: 'https://other.example/mcp' }, token)).toBeNull()
    expect(await verifyAccessToken({ ...signer, now: () => now() + 3601 * 1000 }, token)).toBeNull()
  })
})

describe('the login flow ends in a code bound to the client, the redirect and the pkce challenge', () => {
  it('holds', async () => {
    const p = setup()
    const { code, verifier, state, iss } = await login(p)
    expect(state).toBe('xyz')
    expect(iss).toBe(p.config.issuer)
    const tokens = await p.provider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0])
    expect(tokens.scope).toBe('leaderboard:read')
    expect(await p.provider.verifyBearer(tokens.access_token)).toMatchObject({ subject: 'coach+22@eastontc.com', role: 'coach' })
  })
})

describe('the code exchange refuses a wrong verifier, a used code and a foreign client', () => {
  it('holds', async () => {
    const p = setup()
    const { code, verifier } = await login(p)
    await expect(p.provider.exchangeAuthorizationCode(other, code, verifier, back)).rejects.toThrow()
    await expect(p.provider.exchangeAuthorizationCode(client, code, 'wrong', back)).rejects.toThrow()
    const second = await login(p)
    await p.provider.exchangeAuthorizationCode(client, second.code, second.verifier, back)
    await expect(p.provider.exchangeAuthorizationCode(client, second.code, second.verifier, back)).rejects.toThrow()
    const third = await login(p)
    await expect(p.provider.exchangeAuthorizationCode(client, third.code, third.verifier)).rejects.toThrow()
    await expect(p.provider.exchangeAuthorizationCode(client, third.code, third.verifier, back)).rejects.toThrow()
  })
})

describe('a refresh token rotates on use and a reused token revokes its family', () => {
  it('holds', async () => {
    const p = setup()
    const { code, verifier } = await login(p)
    const first = await p.provider.exchangeAuthorizationCode(client, code, verifier, back)
    const second = await p.provider.exchangeRefreshToken(client, first.refresh_token!)
    expect(second.refresh_token).not.toBe(first.refresh_token)
    await expect(p.provider.exchangeRefreshToken(client, first.refresh_token!)).rejects.toThrow()
    await expect(p.provider.exchangeRefreshToken(client, second.refresh_token!)).rejects.toThrow()
    await expect(p.provider.exchangeRefreshToken(other, second.refresh_token!)).rejects.toThrow()
  })
})

describe('a refresh re-resolves the role, keeps the family expiry and ends when the account is no longer allowed', () => {
  it('holds', async () => {
    let t = Date.parse('2026-10-15T20:00:00Z')
    const p = setup(() => t)
    const { code, verifier } = await login(p)
    const first = await p.provider.exchangeAuthorizationCode(client, code, verifier, back)
    const firstRow = await p.store.getRefreshToken(sha256(first.refresh_token!))
    t += 10 * 24 * 60 * 60 * 1000
    p.roles.set('coach+22@eastontc.com', 'admin')
    const second = await p.provider.exchangeRefreshToken(client, first.refresh_token!)
    expect(await p.provider.verifyBearer(second.access_token)).toMatchObject({ role: 'admin' })
    expect((await p.store.getRefreshToken(sha256(second.refresh_token!)))?.expiresAt).toBe(firstRow?.expiresAt)
    p.roles.set('coach+22@eastontc.com', null)
    await expect(p.provider.exchangeRefreshToken(client, second.refresh_token!)).rejects.toThrow()
    expect((await p.store.getRefreshToken(sha256(second.refresh_token!)))?.revokedAt).not.toBeNull()
    expect(await p.provider.completeLogin((await loginState(p)), 'good')).toBeNull()
  })
})

async function loginState(p: ReturnType<typeof setup>) {
  const res = { redirect: '' }
  const c = { redirect: (url: string) => { res.redirect = url; return new Response(null, { status: 302 }) }, res: new Response() }
  await p.provider.authorize(client, { codeChallenge: sha256('v'), redirectUri: back, scopes: [] }, c as never)
  return new URL(res.redirect).searchParams.get('state')!
}

describe('a stale or tampered login state never reaches consent', () => {
  it('holds', async () => {
    const p = setup()
    expect(await p.provider.completeLogin('not-a-token', 'good')).toBeNull()
    const { code } = await login(p)
    expect(await p.provider.grantConsent(code)).toBeNull()
  })
})

describe('a token carries only the consented scopes the coach Google Groups grant, and a group change applies at the next refresh', () => {
  it('holds', async () => {
    const memberships = new Map<string, string[] | null>([
      ['kids@eastontc.com', ['kids-coaches@eastontc.com']],
      ['front@eastontc.com', []],
      ['boss@eastontc.com', ['admins@eastontc.com']],
      ['gone@eastontc.com', null],
    ])
    const resolve = groupAccess({
      directory: { groupsOf: async email => (memberships.has(email) ? memberships.get(email)! : []) },
      grants: memoryGrants([
        { group: 'Kids-Coaches@eastontc.com', scope: 'docs:read' },
        { group: '*', scope: 'leaderboard:read' },
      ]),
      adminGroup: testConfig.adminGroup,
    })
    const expected: [string, { role: Role; scopes: string[] } | null][] = [
      ['kids@eastontc.com', { role: 'coach', scopes: ['docs:read', 'leaderboard:read'] }],
      ['front@eastontc.com', { role: 'coach', scopes: ['leaderboard:read'] }],
      ['boss@eastontc.com', { role: 'admin', scopes: ['leaderboard:read'] }],
      ['gone@eastontc.com', null],
    ]
    for (const [email, access] of expected) expect(await resolve(email)).toEqual(access)

    const now = () => Date.parse('2026-10-15T20:00:00Z')
    const store = memoryStore(now)
    const provider = eastonProvider({
      config: testConfig,
      store,
      clients: { getClient: async id => (id === client.client_id ? client : undefined) },
      keys,
      google: { ...google, exchange: async () => ({ email: 'front@eastontc.com', name: 'Front' }) },
      resolveAccess: resolve,
      now,
    })
    const res = { redirect: '' }
    const c = { redirect: (url: string) => { res.redirect = url; return new Response(null, { status: 302 }) }, res: new Response() }
    const verifier = randomToken()
    await provider.authorize(
      client,
      { codeChallenge: sha256(verifier), redirectUri: back, scopes: ['docs:read', 'leaderboard:read'] },
      c as never,
    )
    const done = await provider.completeLogin(new URL(res.redirect).searchParams.get('state')!, 'good')
    expect(done!.consent.scopes).toEqual(['docs:read', 'leaderboard:read'])
    expect(done!.consent.granted).toEqual(['leaderboard:read'])
    const code = new URL((await provider.grantConsent(done!.consentToken))!).searchParams.get('code')!
    const first = await provider.exchangeAuthorizationCode(client, code, verifier, back)
    expect(first.scope).toBe('leaderboard:read')
    expect(await provider.verifyBearer(first.access_token)).toMatchObject({ scopes: ['leaderboard:read'] })
    memberships.set('front@eastontc.com', ['kids-coaches@eastontc.com'])
    const joined = await provider.exchangeRefreshToken(client, first.refresh_token!)
    expect(await provider.verifyBearer(joined.access_token)).toMatchObject({ scopes: ['docs:read', 'leaderboard:read'] })
    memberships.set('front@eastontc.com', [])
    const left = await provider.exchangeRefreshToken(client, joined.refresh_token!)
    expect(await provider.verifyBearer(left.access_token)).toMatchObject({ scopes: ['leaderboard:read'] })
    memberships.set('front@eastontc.com', null)
    await expect(provider.exchangeRefreshToken(client, left.refresh_token!)).rejects.toThrow('account is no longer allowed')
  })
})
