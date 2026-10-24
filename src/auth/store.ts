import { createClient } from '@supabase/supabase-js'

export type Role = 'coach' | 'admin'

export interface StoredClient {
  clientId: string
  source: 'dcr' | 'cimd'
  clientName: string | null
  clientSecretHash: string | null
  clientSecretExpiresAt: string | null
  tokenEndpointAuthMethod: string
  redirectUris: string[]
  grantTypes: string[]
  scope: string | null
  metadata: Record<string, unknown>
  createdAt: string
  lastSeenAt: string
}

export interface StoredCode {
  codeHash: string
  clientId: string
  subject: string
  role: Role
  scopes: string[]
  codeChallenge: string
  redirectUri: string
  resource: string | null
  expiresAt: string
  consumedAt: string | null
  createdAt: string
}

export interface StoredRefreshToken {
  tokenHash: string
  familyId: string
  clientId: string
  subject: string
  role: Role
  scopes: string[]
  expiresAt: string
  rotatedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface AuditRow {
  subject: string
  clientId: string | null
  tool: string
  inputHash: string
  input: unknown
  idempotencyKey: string | null
  outcome: 'ok' | 'error' | 'denied' | 'replayed'
  result: unknown
  error: string | null
  durationMs: number
}

export interface AuthStore {
  getClient(clientId: string): Promise<StoredClient | null>
  putClient(client: StoredClient): Promise<void>
  putCode(code: StoredCode): Promise<void>
  takeCode(codeHash: string): Promise<StoredCode | null>
  putRefreshToken(row: StoredRefreshToken): Promise<void>
  getRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null>
  rotateRefreshToken(oldHash: string, next: StoredRefreshToken): Promise<boolean>
  revokeFamily(familyId: string): Promise<void>
  appendAudit(row: AuditRow): Promise<void>
  findAudit(subject: string, tool: string, idempotencyKey: string): Promise<AuditRow | null>
}

export interface MemoryStore extends AuthStore {
  audit(): AuditRow[]
}

type Clock = () => number

export function memoryStore(now: Clock = Date.now): MemoryStore {
  const clients = new Map<string, StoredClient>()
  const codes = new Map<string, StoredCode>()
  const tokens = new Map<string, StoredRefreshToken>()
  const audit: AuditRow[] = []
  const iso = () => new Date(now()).toISOString()
  return {
    async getClient(id) {
      return clients.get(id) ?? null
    },
    async putClient(client) {
      clients.set(client.clientId, client)
    },
    async putCode(code) {
      codes.set(code.codeHash, code)
    },
    async takeCode(hash) {
      const row = codes.get(hash)
      if (!row || row.consumedAt || Date.parse(row.expiresAt) <= now()) return null
      const taken = { ...row, consumedAt: iso() }
      codes.set(hash, taken)
      return taken
    },
    async putRefreshToken(row) {
      tokens.set(row.tokenHash, row)
    },
    async getRefreshToken(hash) {
      return tokens.get(hash) ?? null
    },
    async rotateRefreshToken(oldHash, next) {
      const old = tokens.get(oldHash)
      if (!old || old.rotatedAt || old.revokedAt) return false
      tokens.set(oldHash, { ...old, rotatedAt: iso() })
      tokens.set(next.tokenHash, { ...next, familyId: old.familyId })
      return true
    },
    async revokeFamily(familyId) {
      for (const [hash, row] of tokens) {
        if (row.familyId === familyId && !row.revokedAt) tokens.set(hash, { ...row, revokedAt: iso() })
      }
    },
    async appendAudit(row) {
      audit.push(row)
    },
    async findAudit(subject, tool, idempotencyKey) {
      return (
        audit.find(
          r => r.subject === subject && r.tool === tool && r.idempotencyKey === idempotencyKey && r.outcome === 'ok',
        ) ?? null
      )
    },
    audit() {
      return audit
    },
  }
}

const STORE_TIMEOUT_MS = 3000

const snake = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

function mapKeys(row: object, fn: (key: string) => string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [fn(k), v]))
}

function fromRow<T>(row: object | null): T | null {
  return row ? (mapKeys(row, camel) as T) : null
}

function check(error: { message: string } | null): void {
  if (error) throw new Error(`auth store: ${error.message}`)
}

export function supabaseStore(url: string, serviceRoleKey: string, now: Clock = Date.now): AuthStore {
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(STORE_TIMEOUT_MS) }) },
  })
  const iso = () => new Date(now()).toISOString()
  return {
    async getClient(id) {
      const { data, error } = await db.from('oauth_clients').select('*').eq('client_id', id).maybeSingle()
      check(error)
      return fromRow<StoredClient>(data)
    },
    async putClient(client) {
      const { error } = await db.from('oauth_clients').upsert(mapKeys(client, snake), { onConflict: 'client_id' })
      check(error)
    },
    async putCode(code) {
      const { error } = await db.from('auth_codes').insert(mapKeys(code, snake))
      check(error)
    },
    async takeCode(hash) {
      const { data, error } = await db
        .from('auth_codes')
        .update({ consumed_at: iso() })
        .eq('code_hash', hash)
        .is('consumed_at', null)
        .gt('expires_at', iso())
        .select('*')
        .maybeSingle()
      check(error)
      return fromRow<StoredCode>(data)
    },
    async putRefreshToken(row) {
      const { error } = await db.from('refresh_tokens').insert(mapKeys(row, snake))
      check(error)
    },
    async getRefreshToken(hash) {
      const { data, error } = await db.from('refresh_tokens').select('*').eq('token_hash', hash).maybeSingle()
      check(error)
      return fromRow<StoredRefreshToken>(data)
    },
    async rotateRefreshToken(oldHash, next) {
      const { data, error } = await db.rpc('rotate_refresh_token', { old_hash: oldHash, next: mapKeys(next, snake) })
      check(error)
      return data === true
    },
    async revokeFamily(familyId) {
      const { error } = await db
        .from('refresh_tokens')
        .update({ revoked_at: iso() })
        .eq('family_id', familyId)
        .is('revoked_at', null)
      check(error)
    },
    async appendAudit(row) {
      const { error } = await db.from('audit_log').insert(mapKeys(row, snake))
      check(error)
    },
    async findAudit(subject, tool, idempotencyKey) {
      const { data, error } = await db
        .from('audit_log')
        .select('*')
        .eq('subject', subject)
        .eq('tool', tool)
        .eq('idempotency_key', idempotencyKey)
        .eq('outcome', 'ok')
        .maybeSingle()
      check(error)
      return fromRow<AuditRow>(data)
    },
  }
}
