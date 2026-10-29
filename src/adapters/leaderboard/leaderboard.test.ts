import { describe, expect, it } from 'vitest'
import type { AuthContext } from '../../mcp/registry.js'
import { LEADERBOARD_REST_PATH, leaderboardConfigFromEnv } from './client.js'
import { leaderboard } from './index.js'

const coach: AuthContext = { subject: 'coach@eastontc.com', role: 'coach', scopes: ['leaderboard:read'] }
const config = { url: 'https://lb.supabase.test', publishableKey: 'sb_publishable_test' }

const profile = (id: string, name: string, erp: number, rank: number) => ({
  id,
  name,
  academy: 'Easton Training Center - Boulder',
  belt: 'blue',
  age_division: 'adults',
  age_group: '30+',
  gender: 'Male',
  weight_class: null,
  erp,
  rank_order: rank,
  rank_change: 2,
  synced_at: '2026-10-20T00:00:00Z',
  entries: [{ date: '2026-10-17', competition_name: 'NAGA Denver', placement: 1 }],
  erp_history: [{ computed_at: '2026-10-20T00:00:00Z', erp, rank_order: rank }],
})

const tables: Record<string, unknown[]> = {
  competitors: [
    profile('jake-sciotto-adults', 'Jake Sciotto', 5.4, 176),
    profile('ann-smith', 'Ann Smith', 9.1, 3),
    profile('bob-smith', 'Bob Smith', 2.2, 1),
  ],
  competitions: [
    {
      id: 'naga',
      name: 'NAGA Denver',
      date: '2026-10-17',
      source: 'smoothcomp',
      age_division: 'adults',
      entries: [{ count: 81 }],
    },
  ],
  entries: [
    {
      competitor_id: 'ann-smith',
      competitor_name: 'Ann Smith',
      academy: 'Easton Training Center - Boulder',
      belt: 'blue',
      age_group: '30+',
      age_division: 'adults',
      division: 'Blue 30+',
      type: 'gi',
      placement: 1,
      gold: 1,
      silver: 0,
      bronze: 0,
      wins: 3,
      losses: 0,
      competition_id: 'naga',
      competition_name: 'NAGA Denver',
      date: '2026-10-17',
    },
  ],
  stats_snapshots: [
    {
      period_date: '2026-07-01',
      academy: 'Easton Training Center - Boulder',
      age_division: 'kids',
      unique_athletes: 9,
    },
  ],
}

function fake() {
  const calls: { url: URL; headers: Headers }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    calls.push({ url, headers: new Headers(init?.headers) })
    return Response.json(tables[url.pathname.slice(LEADERBOARD_REST_PATH.length)] ?? [])
  }
  return { fetch, calls }
}

const minimal: Record<string, unknown> = {
  leaderboard_competitors: { names: ['Smith'] },
  leaderboard_rankings: { division: 'adults', academy: 'Boulder' },
  leaderboard_competitions: { query: 'naga', year: 2026 },
  leaderboard_results: { competitions: ['NAGA'], academy: 'Boulder' },
  leaderboard_academy_stats: { academies: ['Boulder'], to: '2026-12-31' },
}

function topLevel(clause: string): string[] {
  const inner = clause.slice(1, -1)
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (quoted && ch === '\\') {
      current += ch + inner[++i]
      continue
    }
    if (ch === '"') quoted = !quoted
    if (!quoted && ch === '(') depth++
    if (!quoted && ch === ')') depth--
    if (!quoted && depth === 0 && ch === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

describe('every leaderboard tool reads through the client with the publishable key and a row cap, and the config refuses a secret key', () => {
  it('holds', async () => {
    const google = fake()
    const adapter = leaderboard(config, google.fetch)
    for (const tool of adapter.tools) {
      expect(tool.scope).toBe('leaderboard:read')
      expect(tool.annotations.readOnlyHint).toBe(true)
      const before = google.calls.length
      await tool.handler({ auth: coach, input: minimal[tool.name] })
      const made = google.calls.slice(before)
      expect(made).toHaveLength(1)
      for (const call of made) {
        expect(call.url.origin).toBe(config.url)
        expect(call.url.pathname.startsWith(LEADERBOARD_REST_PATH)).toBe(true)
        expect(call.headers.get('apikey')).toBe(config.publishableKey)
        expect(call.headers.get('authorization')).toBeNull()
        expect(Number(call.url.searchParams.get('limit'))).toBeGreaterThan(0)
        expect(Number(call.url.searchParams.get('limit'))).toBeLessThanOrEqual(201)
      }
    }
    const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`
    for (const key of ['sb_secret_abc', jwt('service_role'), jwt('authenticated')]) {
      expect(() =>
        leaderboardConfigFromEnv({ LEADERBOARD_SUPABASE_URL: config.url, LEADERBOARD_SUPABASE_PUBLISHABLE_KEY: key }),
      ).toThrow(/publishable key/)
    }
    expect(
      leaderboardConfigFromEnv({
        LEADERBOARD_SUPABASE_URL: config.url,
        LEADERBOARD_SUPABASE_PUBLISHABLE_KEY: jwt('anon'),
      }),
    ).not.toBeNull()
  })
})

describe('a coach string reaches the leaderboard filter only inside a quoted literal', () => {
  it('holds', async () => {
    const hostile = ['a,b', 'x)', '(y', 'q"r', 'back\\slash', 'id.eq.1),name.ilike.*', 'O"Brien, (x)']
    const google = fake()
    const adapter = leaderboard(config, google.fetch)
    const tool = (name: string) => adapter.tools.find(t => t.name === name)!
    await tool('leaderboard_competitors').handler({ auth: coach, input: { names: hostile } })
    const or = google.calls[0].url.searchParams.get('or')!
    const clauses = topLevel(or)
    expect(clauses).toHaveLength(hostile.length * 2)
    for (const [i, value] of hostile.entries()) {
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      expect(clauses[i * 2]).toBe(`id.eq."${escaped}"`)
      expect(clauses[i * 2 + 1]).toBe(`name.ilike."*${escaped}*"`)
    }
    for (const value of hostile) {
      await tool('leaderboard_results').handler({ auth: coach, input: { competitions: ['NAGA'], academy: value } })
      const and = google.calls.at(-1)!.url.searchParams.get('and')!
      expect(topLevel(and)).toHaveLength(1)
    }
  })
})

describe('leaderboard_competitors answers each name on its own with one profile, the candidates for several matches, or not found', () => {
  it('holds', async () => {
    const adapter = leaderboard(config, fake().fetch)
    const res = (await adapter.tools[0].handler({
      auth: coach,
      input: { names: ['Sciotto', 'Smith', 'bob-smith', 'Nobody'] },
    })) as {
      competitors: { name: string; found: boolean; profile?: { id: string }; candidates?: { id: string }[] }[]
    }
    const [jake, smith, bob, nobody] = res.competitors
    expect(jake).toMatchObject({ found: true, profile: { id: 'jake-sciotto-adults' } })
    expect(smith.found).toBe(false)
    expect(smith.candidates!.map(c => c.id)).toEqual(['ann-smith', 'bob-smith'])
    expect(bob).toMatchObject({ found: true, profile: { id: 'bob-smith' } })
    expect(nobody).toMatchObject({ found: false, reason: 'no competitor matches this name or id' })
  })
})

describe('leaderboard_rankings returns the stored rank and ERP in stored rank order and never computes them', () => {
  it('holds', async () => {
    const google = fake()
    const adapter = leaderboard(config, google.fetch)
    const res = (await adapter.tools[1].handler({ auth: coach, input: { division: 'adults' } })) as {
      competitors: { position: number; id: string; erp: number; rank_order: number }[]
    }
    expect(google.calls[0].url.searchParams.get('order')).toBe('rank_order.asc')
    expect(google.calls[0].url.searchParams.get('age_division')).toBe('eq.adults')
    const stored = tables.competitors as { id: string; erp: number; rank_order: number }[]
    expect(res.competitors.map(c => [c.position, c.id, c.erp, c.rank_order])).toEqual(
      stored.map((s, i) => [i + 1, s.id, s.erp, s.rank_order]),
    )
  })
})
