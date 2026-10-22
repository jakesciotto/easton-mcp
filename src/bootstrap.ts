import { serviceAccountFromEnv } from './google/account.js'
import { googleDrive } from './adapters/docs/drive.js'
import { supabaseRegistry } from './adapters/docs/registry.js'
import { leaderboardConfigFromEnv } from './adapters/leaderboard/client.js'
import { createApp } from './app.js'
import { authConfigFromEnv, googleConfigFromEnv, signingKeyFromEnv, stateConfigFromEnv } from './auth/config.js'
import { googleDirectory, noDirectory } from './auth/directory.js'
import { googleLogin } from './auth/google.js'
import { groupAccess, supabaseGrants } from './auth/grants.js'
import { supabaseStore } from './auth/store.js'
import { loadSigningKeys } from './auth/tokens.js'

export function createAppFromEnv(env: Record<string, string | undefined>) {
  const state = stateConfigFromEnv(env)
  const account = serviceAccountFromEnv(env)
  const config = authConfigFromEnv(env)
  const adminEmail = env.GOOGLE_WORKSPACE_ADMIN_EMAIL?.trim()
  const directory = account && adminEmail ? googleDirectory({ account, adminEmail, fetch }) : noDirectory
  return createApp({
    config,
    store: supabaseStore(state.url, state.serviceRoleKey),
    keys: loadSigningKeys(signingKeyFromEnv(env)),
    google: googleLogin({ config: googleConfigFromEnv(env), fetch }),
    resolveAccess: groupAccess({ directory, grants: supabaseGrants(state.url, state.serviceRoleKey), adminGroup: config.adminGroup }),
    leaderboard: leaderboardConfigFromEnv(env) ?? undefined,
    docs: account
      ? { drive: googleDrive({ config: account, fetch }), registry: supabaseRegistry(state.url, state.serviceRoleKey) }
      : undefined,
  })
}
