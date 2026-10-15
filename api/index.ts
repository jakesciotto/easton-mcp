import { getRequestListener } from '@hono/node-server'

type Listener = ReturnType<typeof getRequestListener>

async function buildApp(): Promise<Listener> {
  const { createApp } = await import('../src/app.js')
  return getRequestListener(createApp().fetch)
}

let ready: Promise<Listener> | null = null

function getApp(): Promise<Listener> {
  ready ??= buildApp().catch(e => {
    ready = null
    throw e
  })
  return ready
}

export const config = { api: { bodyParser: false } }

export default async function handler(req: unknown, res: unknown) {
  return (await getApp())(req as never, res as never)
}
