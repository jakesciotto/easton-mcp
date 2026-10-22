import { z } from 'zod'
import type { ToolDef } from '../../../mcp/registry.js'
import type { LeaderboardClient } from '../client.js'
import { anyOf, contains, equals, latest } from '../filters.js'

const ROW_LIMIT = 200
const CANDIDATES = 8
const input = z.object({ names: z.array(z.string().trim().min(2).max(100)).min(1).max(10) })

interface Row {
  id: string
  name: string
  academy: string | null
  belt: string | null
  age_division: string | null
  age_group: string | null
  gender: string | null
  weight_class: string | null
  erp: number | null
  rank_order: number | null
  rank_change: number | null
  synced_at: string | null
  entries: Record<string, unknown>[]
  erp_history: Record<string, unknown>[]
}

function pick(rows: Row[], name: string): Row[] {
  const byId = rows.filter(r => r.id === name)
  if (byId.length) return byId
  const lower = name.toLowerCase()
  const matched = rows.filter(r => r.name.toLowerCase().includes(lower))
  const exact = matched.filter(r => r.name.toLowerCase() === lower)
  return exact.length === 1 ? exact : matched
}

export function leaderboardCompetitors(client: LeaderboardClient): ToolDef {
  return {
    name: 'leaderboard_competitors',
    title: 'Look up competitors',
    description:
      'Look up one to ten competitors on the Easton leaderboard by name or id. Call it when a coach asks how a student is doing, their ERP, rank, belt, academy or recent results. Returns each profile with ERP, rank and rank change within the kids or adults division, the 15 latest entries and the ERP history. A name that matches several competitors answers the candidates with ids; call again with the id.',
    scope: 'leaderboard:read',
    inputSchema: input,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async ({ input: raw }) => {
      const args = input.parse(raw)
      const rows = await client.select<Row>('competitors', [
        [
          'select',
          'id,name,academy,belt,age_division,age_group,gender,weight_class,erp,rank_order,rank_change,synced_at,' +
            'entries(date,competition_name,division,type,placement,gold,silver,bronze,wins,losses),' +
            'erp_history(computed_at,erp,rank_order)',
        ],
        anyOf(args.names.flatMap(n => [equals('id', n), contains('name', n)])),
        ['entries.order', 'date.desc'],
        ['entries.limit', '15'],
        ['erp_history.order', 'computed_at.desc'],
        ['erp_history.limit', '12'],
        ['order', 'name.asc'],
        ['limit', String(ROW_LIMIT)],
      ])
      const full = rows.length >= ROW_LIMIT
      return {
        synced_at: latest(rows),
        competitors: args.names.map(name => {
          const hits = pick(rows, name)
          if (hits.length === 0) {
            const reason = full
              ? 'the lookup reached its row limit before this name, pass a fuller name or the id'
              : 'no competitor matches this name or id'
            return { name, found: false, reason }
          }
          if (hits.length > 1) {
            return {
              name,
              found: false,
              reason: 'more than one competitor matches, pass the id of the one you mean',
              candidates: hits.slice(0, CANDIDATES).map(r => ({
                id: r.id,
                name: r.name,
                academy: r.academy,
                belt: r.belt,
                division: r.age_division,
                age_group: r.age_group,
              })),
            }
          }
          const { synced_at, age_division, ...profile } = hits[0]
          return { name, found: true, profile: { ...profile, division: age_division, synced_at } }
        }),
      }
    },
  }
}
