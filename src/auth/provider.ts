import type { Context } from 'hono'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import { InvalidGrantError, InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { AuthContext } from '../mcp/registry.js'
import type { AuthConfig } from './config.js'
import type { GoogleLogin } from './google.js'
import type { AuthStore, Role } from './store.js'
import {
  ACCESS_TTL_S,
  CODE_TTL_S,
  REFRESH_TTL_S,
  mintAccessToken,
  mintStateToken,
  pkceMatches,
  randomToken,
  sha256,
  verifyAccessToken,
  verifyStateToken,
} from './tokens.js'
import type { SigningKeys } from './tokens.js'

export interface PendingLogin {
  clientId: string
  redirectUri: string
  codeChallenge: string
  scopes: string[]
  state: string | null
  resource: string | null
  nonce: string
}

export interface Consent extends PendingLogin {
  subject: string
  role: Role
}

export type ResolveRole = (email: string) => Promise<Role | null>

export interface ProviderDeps {
  config: AuthConfig
  store: AuthStore
  clients: OAuthRegisteredClientsStore
  keys: SigningKeys
  google: GoogleLogin
  resolveRole: ResolveRole
  now?: () => number
}

export interface EastonProvider extends OAuthServerProvider {
  completeLogin(stateToken: string, googleCode: string): Promise<{ consentToken: string; consent: Consent } | null>
  grantConsent(consentToken: string): Promise<string | null>
  denyConsent(consentToken: string): Promise<string | null>
  verifyBearer(token: string): Promise<AuthContext | null>
}

const toContext = (claims: { subject: string; role: Role; scopes: string[] }): AuthContext => ({
  subject: claims.subject,
  role: claims.role,
  scopes: claims.scopes,
})

export function eastonProvider(deps: ProviderDeps): EastonProvider {
  const now = deps.now ?? Date.now
  const signer = { keys: deps.keys, issuer: deps.config.issuer, audience: deps.config.resourceUrl, now }
  const iso = (offsetS = 0) => new Date(now() + offsetS * 1000).toISOString()
  const grantedScopes = (requested: string[]) =>
    requested.length === 0 ? deps.config.scopes.filter(s => s !== 'offline_access') : requested

  async function issueTokens(claims: { subject: string; role: Role; scopes: string[]; clientId: string; familyId: string }): Promise<OAuthTokens> {
    const scopes = claims.scopes.filter(s => s !== 'offline_access')
    const refresh = randomToken()
    await deps.store.putRefreshToken({
      tokenHash: sha256(refresh),
      familyId: claims.familyId,
      clientId: claims.clientId,
      subject: claims.subject,
      role: claims.role,
      scopes,
      expiresAt: iso(REFRESH_TTL_S),
      rotatedAt: null,
      revokedAt: null,
      createdAt: iso(),
    })
    return {
      access_token: await mintAccessToken(signer, { ...claims, scopes }),
      token_type: 'bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      scope: scopes.join(' '),
    }
  }

  return {
    clientsStore: deps.clients,
    skipLocalPkceValidation: true,

    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, c: Context) {
      if (params.resource && params.resource.href !== deps.config.resourceUrl) {
        throw new InvalidRequestError('resource does not name this server')
      }
      const pending: PendingLogin = {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        scopes: grantedScopes(params.scopes ?? []),
        state: params.state ?? null,
        resource: params.resource?.href ?? null,
        nonce: randomToken(16),
      }
      const stateToken = await mintStateToken(signer, { kind: 'login', pending })
      c.res = c.redirect(deps.google.authorizeUrl(stateToken, pending.nonce), 302)
    },

    async completeLogin(stateToken, googleCode) {
      const payload = await verifyStateToken(signer, stateToken)
      if (!payload || payload.kind !== 'login') return null
      const pending = payload.pending as PendingLogin
      const identity = await deps.google.exchange(googleCode, pending.nonce)
      if (!identity) return null
      const role = await deps.resolveRole(identity.email)
      if (!role) return null
      const consent: Consent = { ...pending, subject: identity.email, role }
      return { consentToken: await mintStateToken(signer, { kind: 'consent', consent }), consent }
    },

    async grantConsent(consentToken) {
      const payload = await verifyStateToken(signer, consentToken)
      if (!payload || payload.kind !== 'consent') return null
      const consent = payload.consent as Consent
      const code = randomToken()
      await deps.store.putCode({
        codeHash: sha256(code),
        clientId: consent.clientId,
        subject: consent.subject,
        role: consent.role,
        scopes: consent.scopes,
        codeChallenge: consent.codeChallenge,
        redirectUri: consent.redirectUri,
        resource: consent.resource,
        expiresAt: iso(CODE_TTL_S),
        consumedAt: null,
        createdAt: iso(),
      })
      const url = new URL(consent.redirectUri)
      url.searchParams.set('code', code)
      if (consent.state) url.searchParams.set('state', consent.state)
      return url.href
    },

    async denyConsent(consentToken) {
      const payload = await verifyStateToken(signer, consentToken)
      if (!payload || payload.kind !== 'consent') return null
      const consent = payload.consent as Consent
      const url = new URL(consent.redirectUri)
      url.searchParams.set('error', 'access_denied')
      if (consent.state) url.searchParams.set('state', consent.state)
      return url.href
    },

    async challengeForAuthorizationCode() {
      throw new InvalidGrantError('PKCE is verified at exchange')
    },

    async exchangeAuthorizationCode(client, code, codeVerifier, redirectUri, resource) {
      const row = await deps.store.takeCode(sha256(code))
      if (!row || row.clientId !== client.client_id) throw new InvalidGrantError('unknown or used code')
      if (!codeVerifier || !pkceMatches(codeVerifier, row.codeChallenge)) {
        throw new InvalidGrantError('code_verifier does not match')
      }
      if (redirectUri !== row.redirectUri) throw new InvalidGrantError('redirect_uri mismatch')
      if (resource && resource.href !== deps.config.resourceUrl) throw new InvalidGrantError('resource mismatch')
      return issueTokens({ ...row, familyId: crypto.randomUUID() })
    },

    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      const hash = sha256(refreshToken)
      const row = await deps.store.getRefreshToken(hash)
      if (!row || row.clientId !== client.client_id) throw new InvalidGrantError('unknown refresh token')
      if (row.revokedAt || row.rotatedAt) {
        await deps.store.revokeFamily(row.familyId)
        throw new InvalidGrantError('refresh token reused')
      }
      if (Date.parse(row.expiresAt) <= now()) throw new InvalidGrantError('refresh token expired')
      if (resource && resource.href !== deps.config.resourceUrl) throw new InvalidGrantError('resource mismatch')
      const requested = (scopes ?? []).filter(s => s !== 'offline_access')
      if (requested.some(s => !row.scopes.includes(s))) throw new InvalidGrantError('scope exceeds the grant')
      const granted = requested.length ? requested : row.scopes
      const role = await deps.resolveRole(row.subject)
      if (!role) {
        await deps.store.revokeFamily(row.familyId)
        throw new InvalidGrantError('account is no longer allowed')
      }
      const next = randomToken()
      const rotated = await deps.store.rotateRefreshToken(hash, {
        tokenHash: sha256(next),
        familyId: row.familyId,
        clientId: row.clientId,
        subject: row.subject,
        role,
        scopes: granted,
        expiresAt: row.expiresAt,
        rotatedAt: null,
        revokedAt: null,
        createdAt: iso(),
      })
      if (!rotated) {
        await deps.store.revokeFamily(row.familyId)
        throw new InvalidGrantError('refresh token reused')
      }
      return {
        access_token: await mintAccessToken(signer, { subject: row.subject, role, scopes: granted, clientId: row.clientId }),
        token_type: 'bearer',
        expires_in: ACCESS_TTL_S,
        refresh_token: next,
        scope: granted.join(' '),
      }
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const claims = await verifyAccessToken(signer, token)
      if (!claims) throw new InvalidGrantError('invalid token')
      return {
        token,
        clientId: claims.clientId,
        scopes: claims.scopes,
        expiresAt: claims.expiresAt,
        resource: new URL(deps.config.resourceUrl),
        extra: { subject: claims.subject, role: claims.role },
      }
    },

    async revokeToken(client, request) {
      const row = await deps.store.getRefreshToken(sha256(request.token))
      if (row && row.clientId === client.client_id) await deps.store.revokeFamily(row.familyId)
    },

    async verifyBearer(token) {
      const claims = await verifyAccessToken(signer, token)
      return claims ? toContext(claims) : null
    },
  }
}
