import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK } from 'jose'
import { GOOGLE_TOKEN_URL, googleLogin } from './google.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const config = {
  clientId: 'gid',
  clientSecret: 'gsecret',
  redirectUri: 'https://mcp.eastontc.com/oauth/google/callback',
  hostedDomain: 'eastontc.com',
}

async function idToken(claims: Record<string, unknown>) {
  return new SignJWT({ email_verified: true, hd: 'eastontc.com', nonce: 'n1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com')
    .setAudience(config.clientId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

async function loginWith(token: string) {
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
  const fetchFake: typeof fetch = async (url, init) => {
    expect(String(url)).toBe(GOOGLE_TOKEN_URL)
    expect(init?.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' })
    return new Response(JSON.stringify({ id_token: token }), { headers: { 'content-type': 'application/json' } })
  }
  return googleLogin({ config, fetch: fetchFake, jwks: createLocalJWKSet({ keys: [jwk] }) })
}

describe('google login accepts only a verified eastontc.com account whose nonce matches', () => {
  it('holds', async () => {
    const ok = await loginWith(await idToken({ email: 'Coach@EastonTC.com', name: 'Coach' }))
    expect(await ok.exchange('code', 'n1')).toEqual({ email: 'coach@eastontc.com', name: 'Coach' })
    const cases: Record<string, unknown>[] = [
      { email: 'x@gmail.com', hd: undefined },
      { email: 'x@eastontc.com', email_verified: false },
      { email: 'x@eastontc.com', nonce: 'other' },
      { email: 'x@eastontc.com', hd: 'other.com' },
    ]
    for (const claims of cases) {
      const login = await loginWith(await idToken(claims))
      expect(await login.exchange('code', 'n1')).toBeNull()
    }
    const url = new URL(ok.authorizeUrl('s', 'n1'))
    expect(url.searchParams.get('hd')).toBe('eastontc.com')
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
  })
})
