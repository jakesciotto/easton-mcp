import { serve } from '@hono/node-server'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: createApp().fetch, port }, info => {
  console.log(`easton-mcp listening on ${info.port}`)
})
