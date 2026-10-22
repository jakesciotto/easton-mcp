export const LEADERBOARD_REST_PATH = '/rest/v1/'
const TIMEOUT_MS = 10_000
const TABLES = ['competitors', 'competitions', 'entries', 'stats_snapshots'] as const

export type LeaderboardTable = (typeof TABLES)[number]

export interface LeaderboardConfig {
  url: string
  publishableKey: string
}

export interface LeaderboardClient {
  select<T>(table: LeaderboardTable, params: [string, string][]): Promise<T[]>
  ping(): Promise<boolean>
}

function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown }
    return claims.role !== 'anon'
  } catch {
    return false
  }
}

export function leaderboardConfigFromEnv(env: Record<string, string | undefined>): LeaderboardConfig | null {
  const url = env.LEADERBOARD_SUPABASE_URL?.trim().replace(/\/+$/, '')
  const publishableKey = env.LEADERBOARD_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey) return null
  if (isSecretKey(publishableKey)) {
    throw new Error('LEADERBOARD_SUPABASE_PUBLISHABLE_KEY holds a secret or service role key; use the publishable key so RLS applies')
  }
  return { url, publishableKey }
}

export function pgrstQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function leaderboardClient(config: LeaderboardConfig, fetchImpl: typeof fetch = fetch): LeaderboardClient {
  async function select<T>(table: LeaderboardTable, params: [string, string][]): Promise<T[]> {
    if (!TABLES.includes(table)) throw new Error(`table ${table} is not readable through the leaderboard adapter`)
    const url = new URL(`${config.url}${LEADERBOARD_REST_PATH}${table}`)
    for (const [k, v] of params) url.searchParams.append(k, v)
    const res = await fetchImpl(url.href, {
      headers: { apikey: config.publishableKey, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: unknown }
      const message = typeof body.message === 'string' ? body.message : `status ${res.status}`
      throw new Error(`leaderboard read of ${table} failed (${res.status}): ${message}`)
    }
    return (await res.json()) as T[]
  }
  return {
    select,
    ping: () => select('competitions', [['select', 'id'], ['limit', '1']]).then(() => true, () => false),
  }
}
