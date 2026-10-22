import { z } from 'zod'
import type { ToolDef } from '../../../mcp/registry.js'
import type { LeaderboardClient } from '../client.js'
import { anyOf, contains, division, text } from '../filters.js'

const input = z.object({
  query: text.optional(),
  year: z.number().int().min(2015).max(2100).optional(),
  source: z.enum(['sheets', 'smoothcomp', 'ibjjf']).optional(),
  division: division.optional(),
  limit: z.number().int().min(1).max(100).default(25),
})

interface Row {
  id: string
  name: string
  date: string
  source: string | null
  age_division: string | null
  entries: { count: number }[]
}

export function leaderboardCompetitions(client: LeaderboardClient): ToolDef {
  return {
    name: 'leaderboard_competitions',
    title: 'List competitions',
    description:
      'List the competitions counted on the Easton leaderboard, newest first, optionally by words in the name, year, source (sheets, smoothcomp or ibjjf) or kids or adults division. Call it when a coach asks which events happened or needs the exact event for leaderboard_results. Returns id, name, date, source, division and the number of entries.',
    scope: 'leaderboard:read',
    inputSchema: input,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async ({ input: raw }) => {
      const args = input.parse(raw)
      const params: [string, string][] = [
        ['select', 'id,name,date,source,age_division,entries(count)'],
        ['enabled', 'eq.true'],
        ['order', 'date.desc'],
        ['limit', String(args.limit)],
      ]
      if (args.query) params.push(anyOf([contains('name', args.query)]))
      if (args.year) params.push(['and', `(date.gte.${args.year}-01-01,date.lte.${args.year}-12-31)`])
      if (args.source) params.push(['source', `eq.${args.source}`])
      if (args.division) params.push(['age_division', `eq.${args.division}`])
      const rows = await client.select<Row>('competitions', params)
      return {
        competitions: rows.map(r => ({
          id: r.id,
          name: r.name,
          date: r.date,
          source: r.source,
          division: r.age_division,
          entries: r.entries[0]?.count ?? 0,
        })),
      }
    },
  }
}
