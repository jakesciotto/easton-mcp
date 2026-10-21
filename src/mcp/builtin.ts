import { z } from 'zod'
import type { Adapter } from './registry.js'

export function builtin(version: string): Adapter {
  return {
    name: 'core',
    tools: [
      {
        name: 'whoami',
        title: 'Who am I',
        description: 'Return the signed in coach, role and granted scopes.',
        scope: '',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        handler: async ({ auth }) => ({ subject: auth.subject, role: auth.role, scopes: auth.scopes, version }),
      },
    ],
    resources: [
      {
        uri: 'easton://about',
        name: 'about',
        scope: '',
        mimeType: 'text/plain',
        read: async () => `Easton MCP ${version}: Easton Training Center tools for coaches.`,
      },
    ],
    health: async () => true,
  }
}
