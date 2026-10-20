import type { Adapter } from "../../mcp/registry.js";
import { leaderboardClient } from "./client.js";
import type { LeaderboardConfig } from "./client.js";

export function leaderboard(config: LeaderboardConfig): Adapter {
  const client = leaderboardClient(config);
  return {
    name: "leaderboard",
    tools: [],
    resources: [],
    health: () => client.ping(),
  };
}
