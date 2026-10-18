import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const TIMEOUT_MS = 8000

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  hostedDomain: string
}

export interface GoogleIdentity {
  email: string
  name: string | null
}

export interface GoogleLogin {
  authorizeUrl(state: string, nonce: string): string
  exchange(code: string, nonce: string): Promise<GoogleIdentity | null>
}

interface Deps {
  config: GoogleConfig
  fetch: typeof fetch
  jwks?: JWTVerifyGetKey
  now?: () => number
}

export function googleLogin(deps: Deps): GoogleLogin {
  const { config } = deps
  const jwks = deps.jwks ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))
  return {
    authorizeUrl(state, nonce) {
      const url = new URL(GOOGLE_AUTHORIZE_URL)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', config.redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', 'openid email profile')
      url.searchParams.set('hd', config.hostedDomain)
      url.searchParams.set('prompt', 'select_account')
      url.searchParams.set('state', state)
      url.searchParams.set('nonce', nonce)
      return url.href
    },
    async exchange(code, nonce) {
      try {
        const res = await deps.fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: config.redirectUri,
            grant_type: 'authorization_code',
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!res.ok) return null
        const body = (await res.json()) as { id_token?: unknown }
        if (typeof body.id_token !== 'string') return null
        const { payload } = await jwtVerify(body.id_token, jwks, {
          issuer: GOOGLE_ISSUERS,
          audience: config.clientId,
          algorithms: ['RS256'],
          currentDate: new Date((deps.now ?? Date.now)()),
        })
        const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
        const domainOk = payload.hd === config.hostedDomain && email?.endsWith(`@${config.hostedDomain}`)
        if (!email || !domainOk || payload.email_verified !== true || payload.nonce !== nonce) return null
        return { email, name: typeof payload.name === 'string' ? payload.name : null }
      } catch {
        return null
      }
    },
  }
}
