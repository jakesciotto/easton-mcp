import { Hono } from 'hono'

export const VERSION = '0.1.0'

export function createApp() {
  const app = new Hono()
  app.get('/health', c => c.json({ ok: true, version: VERSION, adapters: [] as string[] }))
  app.notFound(c => c.json({ error: { code: 'not_found', message: 'not found' } }, 404))
  return app
}
