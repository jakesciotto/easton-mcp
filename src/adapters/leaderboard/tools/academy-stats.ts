import { z } from 'zod'
import type { ToolDef } from '../../../mcp/registry.js'
import type { LeaderboardClient } from '../client.js'
import { anyOf, contains, division, text } from '../filters.js'

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const input = z.object({
  academies: z.array(text).min(1).max(9),
  division: division.optional(),
  granularity: z.enum(['quarterly', 'monthly']).default('quarterly'),
  from: DATE.optional(),
  to: DATE.optional(),
})
const ROW_LIMIT = 200
const METRICS =
  'period_date,academy,age_division,unique_athletes,registrations,wins,losses,win_rate,podium_count,podium_rate,champ_count,champ_rate,gold,silver,bronze,total_medals'

export function leaderboardAcademyStats(client: LeaderboardClient, now: () => number = Date.now): ToolDef {
  return {
    name: 'leaderboard_academy_stats',
    title: 'Read academy statistics',
    description:
      'Read competition statistics for one to nine Easton academies (location names such as Boulder or Lowry) per quarter or month: athletes, registrations, record, win rate, podium and champion rates and medals, for the kids or adults division or both. Call it when a coach compares locations or asks how an academy is trending. The period starts at from, or January 1 of last year when from is absent.',
    scope: 'leaderboard:read',
    inputSchema: input,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async ({ input: raw }) => {
      const args = input.parse(raw)
      const from = args.from ?? `${new Date(now()).getUTCFullYear() - 1}-01-01`
      const params: [string, string][] = [
        ['select', METRICS],
        ['granularity', `eq.${args.granularity}`],
        ['type', 'is.null'],
        ['belt', 'is.null'],
        ['age_group', 'is.null'],
        ['competitor_id', 'is.null'],
        ['competition_id', 'is.null'],
        anyOf(args.academies.map(a => contains('academy', a))),
        ['period_date', `gte.${from}`],
        ['order', 'academy.asc,age_division.asc,period_date.asc'],
        ['limit', String(ROW_LIMIT + 1)],
      ]
      if (args.to) params.push(['and', `(period_date.lte.${args.to})`])
      if (args.division) params.push(['age_division', `eq.${args.division}`])
      const rows = await client.select<Record<string, unknown>>('stats_snapshots', params)
      return {
        from,
        to: args.to ?? null,
        granularity: args.granularity,
        periods: rows.slice(0, ROW_LIMIT),
        truncated: rows.length > ROW_LIMIT,
      }
    },
  }
}
