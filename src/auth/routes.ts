import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import {
  authenticateClient,
  authorizeHandler,
  clientRegistrationHandler,
  revokeHandler,
  tokenHandler,
} from '@hono/mcp/auth'
import type { AuthContext } from '../mcp/registry.js'
import type { AuthConfig } from './config.js'
import { consentPage } from './consent.js'
import { authorizationServerMetadata, protectedResourceMetadata } from './metadata.js'
import type { EastonProvider } from './provider.js'

export type AuthEnv = { Variables: { auth: AuthContext } }

export function unauthorized(config: AuthConfig): Response {
  const scope = config.scopes.filter(s => s !== 'offline_access').join(' ')
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource/mcp", scope="${scope}"`,
    },
  })
}

export function requireBearer(
  verify: (token: string) => Promise<AuthContext | null>,
  config: AuthConfig,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(c.req.header('authorization') ?? '')
    const ctx = match?.[1] ? await verify(match[1]) : null
    if (!ctx) return unauthorized(config)
    c.set('auth', ctx)
    await next()
  }
}

const noStore: MiddlewareHandler = async (c, next) => {
  await next()
  c.header('cache-control', 'no-store')
}

export function authRoutes(deps: { config: AuthConfig; provider: EastonProvider }): Hono {
  const { config, provider } = deps
  const app = new Hono()
  const server = authorizationServerMetadata(config)
  const resource = protectedResourceMetadata(config)
  const clientAuth = authenticateClient({ clientsStore: provider.clientsStore })

  app.get('/.well-known/oauth-authorization-server', c => c.json(server))
  app.get('/.well-known/oauth-authorization-server/mcp', c => c.json(server))
  app.get('/.well-known/oauth-protected-resource', c => c.json(resource))
  app.get('/.well-known/oauth-protected-resource/mcp', c => c.json(resource))

  app.post(
    '/oauth/register',
    clientRegistrationHandler({ clientsStore: provider.clientsStore, clientIdGeneration: false }),
  )
  app.get('/oauth/authorize', authorizeHandler(provider))
  app.post('/oauth/authorize', authorizeHandler(provider))
  app.post('/oauth/token', clientAuth, tokenHandler(provider))
  app.post('/oauth/revoke', clientAuth, revokeHandler(provider))

  app.get('/oauth/google/callback', noStore, async c => {
    const { state, code, error } = c.req.query()
    if (error || !state || !code) return c.text('Sign-in was cancelled or failed.', 400)
    const done = await provider.completeLogin(state, code)
    if (!done) return c.text('Sign-in failed. Use your eastontc.com account.', 403)
    const client = await provider.clientsStore.getClient(done.consent.clientId)
    return c.html(consentPage(done.consent, client?.client_name ?? 'Claude', done.consentToken))
  })

  app.post('/oauth/consent', noStore, async c => {
    const body = await c.req.parseBody()
    const token = typeof body.consent === 'string' ? body.consent : ''
    const location = body.decision === 'allow' ? await provider.grantConsent(token) : await provider.denyConsent(token)
    if (!location) return c.text('This consent request expired. Start again from Claude.', 400)
    return c.redirect(location, 302)
  })

  return app
}
