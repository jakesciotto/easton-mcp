import { SignJWT, importPKCS8 } from 'jose'
import type { ServiceAccount } from './account.js'

export const DELEGATION_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TIMEOUT_MS = 15_000
const TOKEN_TTL_S = 3600
const TOKEN_MARGIN_MS = 60_000

export interface DelegatedTokens {
  tokenFor(subject: string): Promise<string>
}

interface Deps {
  account: ServiceAccount
  scope: string
  fetch: typeof fetch
  now?: () => number
}

export function delegatedTokens(deps: Deps): DelegatedTokens {
  const now = deps.now ?? Date.now
  const tokens = new Map<string, { token: Promise<string>; expiresAt: number }>()
  let key: Promise<CryptoKey | Uint8Array> | null = null

  async function assertion(subject: string): Promise<string> {
    key ??= importPKCS8(deps.account.privateKey, 'RS256').catch(err => {
      key = null
      throw new Error(`GOOGLE_PRIVATE_KEY is not a PKCS8 RSA key: ${err instanceof Error ? err.message : String(err)}`)
    })
    const iat = Math.floor(now() / 1000)
    return new SignJWT({ scope: deps.scope })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(deps.account.serviceAccountEmail)
      .setSubject(subject)
      .setAudience(DELEGATION_TOKEN_URL)
      .setIssuedAt(iat)
      .setExpirationTime(iat + TOKEN_TTL_S)
      .sign(await key)
  }

  async function exchange(subject: string): Promise<{ token: string; expiresIn: number }> {
    const res = await deps.fetch(DELEGATION_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await assertion(subject),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: unknown
      expires_in?: unknown
      error?: unknown
      error_description?: unknown
    }
    if (!res.ok || typeof body.access_token !== 'string') {
      const code = typeof body.error === 'string' ? body.error : String(res.status)
      const detail = typeof body.error_description === 'string' ? ` ${body.error_description}.` : ''
      throw new Error(
        `google refused to act as ${subject} (${code}).${detail} Check domain wide delegation for ${deps.scope} on the service account client id.`,
      )
    }
    return { token: body.access_token, expiresIn: typeof body.expires_in === 'number' ? body.expires_in : TOKEN_TTL_S }
  }

  return {
    tokenFor(rawSubject) {
      const subject = rawSubject.toLowerCase()
      const hit = tokens.get(subject)
      if (hit && hit.expiresAt - TOKEN_MARGIN_MS > now()) return hit.token
      const entry = { token: Promise.resolve(''), expiresAt: now() + TOKEN_TTL_S * 1000 }
      entry.token = exchange(subject).then(
        ({ token, expiresIn }) => {
          entry.expiresAt = now() + expiresIn * 1000
          return token
        },
        err => {
          tokens.delete(subject)
          throw err
        },
      )
      tokens.set(subject, entry)
      return entry.token
    },
  }
}
