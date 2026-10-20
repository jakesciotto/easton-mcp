export interface LeaderboardConfig {
  url: string;
  publishableKey: string;
}

export interface LeaderboardClient {
  ping(): Promise<boolean>;
}

export function leaderboardConfigFromEnv(
  env: NodeJS.ProcessEnv,
): LeaderboardConfig | null {
  const url = env.LEADERBOARD_SUPABASE_URL;
  const publishableKey = env.LEADERBOARD_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function leaderboardClient(
  config: LeaderboardConfig,
): LeaderboardClient {
  void config;
  return {
    ping: async () => false,
  };
}
