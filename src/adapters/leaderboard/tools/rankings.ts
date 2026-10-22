import { z } from 'zod'
import type { ToolDef } from '../../../mcp/registry.js'
import type { LeaderboardClient } from '../client.js'
import { anyOf, belt, contains, division, latest, text } from '../filters.js'

const input = z.object({
  division,
  academy: text.optional(),
  belt: belt.optional(),
  age_group: text.optional(),
  gender: z.enum(['Male', 'Female']).optional(),
  limit: z.number().int().min(1).max(100).default(25),
})

export function leaderboardRankings(client: LeaderboardClient): ToolDef {
  return {
    name: 'leaderboard_rankings',
    title: 'Read the rankings',
    description:
      'Read the Easton leaderboard ranking for the kids or adults division, in stored rank order, optionally narrowed to one academy (a location name such as Boulder), belt, age group such as 8-9 or 30+, or gender. Call it when a coach asks who the top competitors are. Returns up to limit competitors with rank, rank change and ERP; position is the place inside the narrowed list. Call leaderboard_competitors for one competitor in depth.',
    scope: 'leaderboard:read',
    inputSchema: input,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async ({ input: raw }) => {
      const args = input.parse(raw)
      const params: [string, string][] = [
        ['select', 'id,name,academy,belt,age_group,gender,erp,rank_order,rank_change,synced_at'],
        ['age_division', `eq.${args.division}`],
        ['rank_order', 'not.is.null'],
        ['order', 'rank_order.asc'],
        ['limit', String(args.limit)],
      ]
      if (args.academy) params.push(anyOf([contains('academy', args.academy)]))
      if (args.belt) params.push(['belt', `eq.${args.belt}`])
      if (args.age_group) params.push(['age_group', `eq.${args.age_group}`])
      if (args.gender) params.push(['gender', `eq.${args.gender}`])
      const rows = await client.select<Record<string, unknown> & { synced_at: string | null }>('competitors', params)
      return {
        division: args.division,
        synced_at: latest(rows),
        competitors: rows.map((r, i) => {
          const { synced_at, ...rest } = r
          void synced_at
          return { position: i + 1, ...rest }
        }),
      }
    },
  }
}
