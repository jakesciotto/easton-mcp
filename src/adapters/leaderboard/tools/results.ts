import { z } from 'zod'
import type { ToolDef } from '../../../mcp/registry.js'
import type { LeaderboardClient } from '../client.js'
import { anyOf, belt, contains, equals, text } from '../filters.js'

const input = z.object({
  competitions: z.array(z.string().trim().min(2).max(150)).min(1).max(5),
  academy: text.optional(),
  belt: belt.optional(),
  age_group: text.optional(),
  limit: z.number().int().min(1).max(200).default(100),
})

interface Row {
  competitor_id: string
  competitor_name: string
  academy: string | null
  belt: string | null
  age_group: string | null
  age_division: string | null
  division: string | null
  type: string | null
  placement: number | null
  gold: number
  silver: number
  bronze: number
  wins: number
  losses: number
  competition_id: string
  competition_name: string
  date: string
}

export function leaderboardResults(client: LeaderboardClient): ToolDef {
  return {
    name: 'leaderboard_results',
    title: 'Read competition results',
    description:
      'Read the Easton results at one to five competitions, by competition id or words in the event name, optionally narrowed to one academy (a location name such as Denver), belt or age group. Call it when a coach asks how Easton did at an event. Returns each event with its entries: competitor, academy, belt, bracket, placement, medals and record. Call leaderboard_competitions first when the event name is unclear.',
    scope: 'leaderboard:read',
    inputSchema: input,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async ({ input: raw }) => {
      const args = input.parse(raw)
      const params: [string, string][] = [
        [
          'select',
          'competitor_id,competitor_name,academy,belt,age_group,age_division,division,type,placement,gold,silver,bronze,wins,losses,' +
            'competition_id,competition_name,date,competitions!inner(enabled)',
        ],
        ['competitions.enabled', 'eq.true'],
        anyOf(args.competitions.flatMap(c => [equals('competition_id', c), contains('competition_name', c)])),
        ['order', 'date.desc,competition_name.asc,placement.asc.nullslast'],
        ['limit', String(args.limit + 1)],
      ]
      if (args.academy) params.push(['and', `(${contains('academy', args.academy)})`])
      if (args.belt) params.push(['belt', `eq.${args.belt}`])
      if (args.age_group) params.push(['age_group', `eq.${args.age_group}`])
      const rows = await client.select<Row>('entries', params)
      const kept = rows.slice(0, args.limit)
      const events = new Map<string, { id: string; name: string; date: string; entries: Record<string, unknown>[] }>()
      for (const r of kept) {
        const event = events.get(r.competition_id) ?? {
          id: r.competition_id,
          name: r.competition_name,
          date: r.date,
          entries: [],
        }
        event.entries.push({
          competitor_id: r.competitor_id,
          competitor: r.competitor_name,
          academy: r.academy,
          belt: r.belt,
          age_group: r.age_group,
          division: r.age_division,
          bracket: r.division,
          type: r.type,
          placement: r.placement,
          gold: r.gold,
          silver: r.silver,
          bronze: r.bronze,
          wins: r.wins,
          losses: r.losses,
        })
        events.set(r.competition_id, event)
      }
      const unmatched = args.competitions.filter(
        c => !kept.some(r => r.competition_id === c || r.competition_name.toLowerCase().includes(c.toLowerCase())),
      )
      return { competitions: [...events.values()], truncated: rows.length > args.limit, unmatched }
    },
  }
}
