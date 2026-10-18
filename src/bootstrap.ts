import { createApp } from './app.js'
import { authConfigFromEnv, googleConfigFromEnv, signingKeyFromEnv, stateConfigFromEnv } from './auth/config.js'
import { googleLogin } from './auth/google.js'
import { supabaseStore } from './auth/store.js'
import { loadSigningKeys } from './auth/tokens.js'

export function createAppFromEnv(env: Record<string, string | undefined>) {
  const state = stateConfigFromEnv(env)
  return createApp({
    config: authConfigFromEnv(env),
    store: supabaseStore(state.url, state.serviceRoleKey),
    keys: loadSigningKeys(signingKeyFromEnv(env)),
    google: googleLogin({ config: googleConfigFromEnv(env), fetch }),
  })
}
