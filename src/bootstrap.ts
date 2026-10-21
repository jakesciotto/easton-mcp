import { docsConfigFromEnv } from './adapters/docs/config.js'
import { googleDrive } from './adapters/docs/drive.js'
import { supabaseRegistry } from './adapters/docs/registry.js'
import { leaderboardConfigFromEnv } from './adapters/leaderboard/client.js'
import { createApp } from './app.js'
import { authConfigFromEnv, googleConfigFromEnv, signingKeyFromEnv, stateConfigFromEnv } from './auth/config.js'
import { googleLogin } from './auth/google.js'
import { supabaseStore } from './auth/store.js'
import { loadSigningKeys } from './auth/tokens.js'

export function createAppFromEnv(env: Record<string, string | undefined>) {
  const state = stateConfigFromEnv(env)
  const docsConfig = docsConfigFromEnv(env)
  return createApp({
    config: authConfigFromEnv(env),
    store: supabaseStore(state.url, state.serviceRoleKey),
    keys: loadSigningKeys(signingKeyFromEnv(env)),
    google: googleLogin({ config: googleConfigFromEnv(env), fetch }),
    leaderboard: leaderboardConfigFromEnv(env) ?? undefined,
    docs: docsConfig
      ? { drive: googleDrive({ config: docsConfig, fetch }), registry: supabaseRegistry(state.url, state.serviceRoleKey) }
      : undefined,
  })
}
