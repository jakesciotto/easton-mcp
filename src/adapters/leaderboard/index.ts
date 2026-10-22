import type { Adapter } from '../../mcp/registry.js'
import { leaderboardClient } from './client.js'
import type { LeaderboardConfig } from './client.js'
import { leaderboardAcademyStats } from './tools/academy-stats.js'
import { leaderboardCompetitions } from './tools/competitions.js'
import { leaderboardCompetitors } from './tools/competitors.js'
import { leaderboardRankings } from './tools/rankings.js'
import { leaderboardResults } from './tools/results.js'

export function leaderboard(config: LeaderboardConfig, fetchImpl: typeof fetch = fetch): Adapter {
  const client = leaderboardClient(config, fetchImpl)
  return {
    name: 'leaderboard',
    tools: [
      leaderboardCompetitors(client),
      leaderboardRankings(client),
      leaderboardCompetitions(client),
      leaderboardResults(client),
      leaderboardAcademyStats(client),
    ],
    resources: [],
    health: () => client.ping(),
  }
}
