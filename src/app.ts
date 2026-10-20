import { Hono } from 'hono'
import type { Context } from 'hono'
import { leaderboard } from './adapters/leaderboard/index.js'
import type { LeaderboardConfig } from './adapters/leaderboard/client.js'
import { clientsStore } from './auth/clients.js'
import type { AuthConfig } from './auth/config.js'
import type { GoogleLogin } from './auth/google.js'
import { eastonProvider } from './auth/provider.js'
import type { ResolveRole } from './auth/provider.js'
import { authRoutes, requireBearer } from './auth/routes.js'
import type { AuthEnv } from './auth/routes.js'
import type { AuthStore } from './auth/store.js'
import type { SigningKeys } from './auth/tokens.js'
import { builtin } from './mcp/builtin.js'
import { createMcpHandler } from './mcp/registry.js'
import type { AuthContext } from './mcp/registry.js'

export const VERSION = '0.1.0'

export interface AppOptions {
  config: AuthConfig
  store: AuthStore
  keys: SigningKeys
  google: GoogleLogin
  leaderboard?: LeaderboardConfig
  resolveRole?: ResolveRole
  fetch?: typeof fetch
  verify?: (token: string) => Promise<AuthContext | null>
  now?: () => number
}

export function createApp(opts: AppOptions) {
  const app = new Hono<AuthEnv>()
  const clients = clientsStore({ store: opts.store, config: opts.config, fetch: opts.fetch ?? fetch, now: opts.now })
  const provider = eastonProvider({
    config: opts.config,
    store: opts.store,
    clients,
    keys: opts.keys,
    google: opts.google,
    resolveRole: opts.resolveRole ?? (async () => 'coach'),
    now: opts.now,
  })
  const verify = opts.verify ?? provider.verifyBearer
  const adapters = [builtin(VERSION), ...(opts.leaderboard ? [leaderboard(opts.leaderboard)] : [])]
  app.get('/health', c => c.json({ ok: true, version: VERSION, adapters: adapters.map(a => a.name) }))
  app.route('/', authRoutes({ config: opts.config, provider }))
  app.post(
    '/mcp',
    requireBearer(verify, opts.config),
    createMcpHandler({ adapters, store: opts.store, now: opts.now, version: VERSION }),
  )
  const notAllowed = (c: Context) =>
    c.json({ error: { code: 'method_not_allowed', message: 'use POST' } }, 405, { allow: 'POST' })
  app.get('/mcp', notAllowed)
  app.delete('/mcp', notAllowed)
  app.notFound(c => c.json({ error: { code: 'not_found', message: 'not found' } }, 404))
  return app
}
