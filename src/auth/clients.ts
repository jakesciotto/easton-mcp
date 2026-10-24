import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { AuthConfig } from './config.js'
import type { AuthStore, StoredClient } from './store.js'

const CIMD_TTL_MS = 60 * 60 * 1000
const CIMD_TIMEOUT_MS = 5000
const CIMD_MAX_BYTES = 65536
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1']
const CORE_FIELDS = [
  'client_id',
  'client_name',
  'redirect_uris',
  'token_endpoint_auth_method',
  'grant_types',
  'scope',
  'client_secret',
  'client_secret_expires_at',
  'client_id_issued_at',
]
const DEFAULT_GRANTS = ['authorization_code', 'refresh_token']

interface Deps {
  store: AuthStore
  config: AuthConfig
  fetch: typeof fetch
  now?: () => number
}

function parse(uri: string): URL | null {
  try {
    return new URL(uri)
  } catch {
    return null
  }
}

export function isAllowedRedirect(uri: string, allowed: string[]): boolean {
  const url = parse(uri)
  if (!url) return false
  if (url.protocol === 'https:') return allowed.includes(uri)
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(url.hostname)) return false
  return allowed.some(entry => {
    const base = parse(entry)
    return (
      base !== null && base.protocol === 'http:' && base.hostname === url.hostname && base.pathname === url.pathname
    )
  })
}

function omit(value: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)))
}

function toInfo(row: StoredClient): OAuthClientInformationFull {
  return {
    ...row.metadata,
    client_id: row.clientId,
    client_id_issued_at: Math.floor(Date.parse(row.createdAt) / 1000),
    client_name: row.clientName ?? undefined,
    redirect_uris: row.redirectUris,
    token_endpoint_auth_method: row.tokenEndpointAuthMethod,
    grant_types: row.grantTypes,
    scope: row.scope ?? undefined,
  } as OAuthClientInformationFull
}

function toRow(info: OAuthClientInformationFull, source: StoredClient['source'], at: string): StoredClient {
  const { client_id, client_name, redirect_uris, token_endpoint_auth_method, grant_types, scope } = info
  const metadata = omit(info, CORE_FIELDS)
  return {
    clientId: client_id,
    source,
    clientName: client_name ?? null,
    clientSecretHash: null,
    clientSecretExpiresAt: null,
    tokenEndpointAuthMethod: token_endpoint_auth_method ?? 'none',
    redirectUris: redirect_uris,
    grantTypes: grant_types ?? DEFAULT_GRANTS,
    scope: scope ?? null,
    metadata,
    createdAt: at,
    lastSeenAt: at,
  }
}

export function clientsStore(deps: Deps): OAuthRegisteredClientsStore {
  const now = deps.now ?? Date.now
  const allScopes = deps.config.scopes.join(' ')
  const cache = new Map<string, { info: OAuthClientInformationFull; expires: number }>()

  async function resolveCimd(id: string): Promise<OAuthClientInformationFull | undefined> {
    const hit = cache.get(id)
    if (hit && hit.expires > now()) return hit.info
    try {
      const res = await deps.fetch(id, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
      })
      if (!res.ok) return undefined
      const text = await res.text()
      if (text.length > CIMD_MAX_BYTES) return undefined
      const doc = JSON.parse(text) as Record<string, unknown>
      const listed = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(u => typeof u === 'string') : []
      const uris = listed.filter(u => isAllowedRedirect(u, deps.config.allowedRedirects))
      if (doc.client_id !== id || uris.length === 0) return undefined
      const info = {
        ...omit(doc, ['client_secret', 'client_secret_expires_at']),
        client_id: id,
        redirect_uris: uris,
        token_endpoint_auth_method: 'none',
        scope: typeof doc.scope === 'string' ? doc.scope : allScopes,
      } as OAuthClientInformationFull
      cache.set(id, { info, expires: now() + CIMD_TTL_MS })
      return info
    } catch {
      return undefined
    }
  }

  return {
    async getClient(id) {
      const url = parse(id)
      if (url?.protocol === 'https:' && deps.config.cimdHosts.includes(url.hostname)) {
        return resolveCimd(id)
      }
      const row = await deps.store.getClient(id)
      return row ? { ...toInfo(row), scope: row.scope ?? allScopes } : undefined
    },
    async registerClient(client) {
      const redirects = client.redirect_uris.map(String)
      if (redirects.length === 0) throw new InvalidClientMetadataError('redirect_uris is empty')
      for (const uri of redirects) {
        if (!isAllowedRedirect(uri, deps.config.allowedRedirects)) {
          throw new InvalidClientMetadataError('redirect_uri is not allowed')
        }
      }
      const issued = Math.floor(now() / 1000)
      const info = {
        ...client,
        redirect_uris: redirects,
        client_id: crypto.randomUUID(),
        client_id_issued_at: issued,
        token_endpoint_auth_method: 'none',
        scope: client.scope ?? allScopes,
        client_secret: undefined,
        client_secret_expires_at: undefined,
      } as unknown as OAuthClientInformationFull
      await deps.store.putClient(toRow(info, 'dcr', new Date(issued * 1000).toISOString()))
      return JSON.parse(JSON.stringify(info)) as OAuthClientInformationFull
    },
  }
}
