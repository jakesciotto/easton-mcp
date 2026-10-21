import { z } from 'zod'
import type { ToolDef } from '../../../mcp/registry.js'
import { driveString, listInRoots } from '../drive.js'
import type { DriveClient } from '../drive.js'
import type { DocumentRegistry } from '../registry.js'

const input = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().min(1).max(20).default(5),
})

export function docsSearch(deps: { drive: DriveClient; registry: DocumentRegistry }): ToolDef {
  return {
    name: 'docs_search',
    title: 'Search SOP documents',
    description:
      'Search the registered Easton SOP Google Docs by words in their title or text. Call it when a coach asks how something is done at Easton and you do not know which SOP holds the answer. Returns up to limit documents with id, title and last modified time. Pass the id or the exact title to docs_read for the text.',
    scope: 'docs:read',
    inputSchema: input,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async ({ auth, input: raw }) => {
      const args = input.parse(raw)
      const roots = await deps.registry.roots()
      if (roots.length === 0) return { documents: [], note: 'no documents are registered' }
      const files = await listInRoots(deps.drive, auth.subject, roots, `fullText contains '${driveString(args.query)}'`, args.limit)
      return {
        documents: files.map(f => ({ id: f.id, title: f.name, modified: f.modifiedTime, link: f.webViewLink })),
      }
    },
  }
}
