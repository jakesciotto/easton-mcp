import { serve } from '@hono/node-server'
import { createAppFromEnv } from './bootstrap.js'
import { portFromEnv } from './auth/config.js'

serve({ fetch: createAppFromEnv(process.env).fetch, port: portFromEnv(process.env) }, info => {
  console.log(`easton-mcp listening on ${info.port}`)
})
