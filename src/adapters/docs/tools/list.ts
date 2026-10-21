import { z } from 'zod'
import type { ToolDef } from '../../../mcp/registry.js'
import type { DocumentRegistry } from '../registry.js'

const input = z.object({})

export function docsList(deps: { registry: DocumentRegistry }): ToolDef {
  return {
    name: 'docs_list',
    title: 'List SOP collections',
    description:
      'List the registered Easton SOP collections, one per program such as kids or adults, with the collection name and its Drive id. Call it when you need the collection names for docs_search or when a coach asks which SOP sets exist. Takes no input.',
    scope: 'docs:read',
    inputSchema: input,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async () => {
      const roots = await deps.registry.roots()
      return { collections: roots.map(r => ({ name: r.title, id: r.driveId, kind: r.kind })) }
    },
  }
}
