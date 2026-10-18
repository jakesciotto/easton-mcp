import { getRequestListener } from '@hono/node-server'

type Listener = ReturnType<typeof getRequestListener>

async function buildApp(): Promise<Listener> {
  const { createAppFromEnv } = await import('../src/bootstrap.js')
  return getRequestListener(createAppFromEnv(process.env).fetch)
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
