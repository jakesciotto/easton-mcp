import { waitUntil } from '@vercel/functions'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { docs } from './adapters/docs/index.js'
import type { DocsDeps } from './adapters/docs/index.js'
import { leaderboard } from './adapters/leaderboard/index.js'
import type { LeaderboardConfig } from './adapters/leaderboard/client.js'
import { clientsStore } from './auth/clients.js'
import type { AuthConfig } from './auth/config.js'
import type { GoogleLogin } from './auth/google.js'
import { eastonProvider } from './auth/provider.js'
import type { ResolveAccess } from './auth/grants.js'
import { authRoutes, requireBearer } from './auth/routes.js'
import type { AuthEnv } from './auth/routes.js'
import type { AuthStore } from './auth/store.js'
import type { SigningKeys } from './auth/tokens.js'
import { builtin } from './mcp/builtin.js'
import { createMcpHandler } from './mcp/registry.js'
import type { AuthContext } from './mcp/registry.js'
import { noSink, telemetry as createTelemetry } from './telemetry/telemetry.js'
import type { TelemetrySink } from './telemetry/telemetry.js'

export const VERSION = '0.1.0'

export interface AppOptions {
  config: AuthConfig
  store: AuthStore
  keys: SigningKeys
  google: GoogleLogin
  leaderboard?: LeaderboardConfig
  docs?: DocsDeps
  resolveAccess?: ResolveAccess
  telemetry?: TelemetrySink
  defer?: (work: Promise<unknown>) => void
  fetch?: typeof fetch
  verify?: (token: string) => Promise<AuthContext | null>
  now?: () => number
}

export function createApp(opts: AppOptions) {
  const app = new Hono<AuthEnv>()
  const telemetry = createTelemetry(opts.telemetry ?? noSink)
  const defer = opts.defer ?? waitUntil
  app.use(async (_c, next) => {
    try {
      await next()
    } finally {
      try {
        defer(telemetry.flush())
      } catch (err) {
        console.warn(`telemetry defer failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  })
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    console.error(error)
    telemetry.exception(error, c.get('auth')?.subject)
    return c.json({ error: { code: 'server_error', message: 'internal error' } }, 500)
  })
  const clients = clientsStore({ store: opts.store, config: opts.config, fetch: opts.fetch ?? fetch, now: opts.now })
  const provider = eastonProvider({
    config: opts.config,
    store: opts.store,
    clients,
    keys: opts.keys,
    google: opts.google,
    resolveAccess:
      opts.resolveAccess ??
      (async () => ({ role: 'coach', scopes: opts.config.scopes.filter(s => s !== 'offline_access') })),
    now: opts.now,
  })
  const verify = opts.verify ?? provider.verifyBearer
  const adapters = [
    builtin(VERSION),
    ...(opts.leaderboard ? [leaderboard(opts.leaderboard, opts.fetch ?? fetch)] : []),
    ...(opts.docs ? [docs(opts.docs)] : []),
  ]
  app.get('/health', c => c.json({ ok: true, version: VERSION, adapters: adapters.map(a => a.name) }))
  app.route('/', authRoutes({ config: opts.config, provider }))
  app.post(
    '/mcp',
    requireBearer(verify, opts.config),
    createMcpHandler({ adapters, store: opts.store, telemetry, now: opts.now, version: VERSION }),
  )
  const notAllowed = (c: Context) =>
    c.json({ error: { code: 'method_not_allowed', message: 'use POST' } }, 405, { allow: 'POST' })
  app.get('/mcp', notAllowed)
  app.delete('/mcp', notAllowed)
  app.notFound(c => c.json({ error: { code: 'not_found', message: 'not found' } }, 404))
  return app
}
