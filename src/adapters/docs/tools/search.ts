import { z } from 'zod'
import type { ToolDef } from '../../../mcp/registry.js'
import { driveString, listInRoots, rootOf } from '../drive.js'
import type { DriveClient } from '../drive.js'
import type { DocumentRegistry, RegistryRoot } from '../registry.js'

const input = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().min(1).max(20).default(5),
  collection: z.string().trim().min(1).max(100).optional(),
})

export function selectCollection(roots: RegistryRoot[], collection: string | undefined): RegistryRoot[] {
  if (collection === undefined) return roots
  const wanted = collection.toLowerCase()
  const chosen = roots.filter(r => r.title.toLowerCase() === wanted)
  if (chosen.length === 0) {
    throw new Error(
      `collection "${collection}" is not registered; registered collections: ${roots.map(r => r.title).join(', ')}`,
    )
  }
  return chosen
}

export function docsSearch(deps: { drive: DriveClient; registry: DocumentRegistry }): ToolDef {
  return {
    name: 'docs_search',
    title: 'Search SOP documents',
    description:
      'Search the registered Easton SOP Google Docs by words in their title or text. Call it when a coach asks how something is done at Easton and you do not know which SOP holds the answer. Documents are grouped in collections, one per program such as kids or adults; pass collection to search one collection only, and call docs_list for the collection names. Returns up to limit documents with id, title, collection and last modified time. When partial is true, some collections did not answer (listed in failed) or Drive cut the search short, so say the results may be incomplete. Pass the id or the exact title to docs_read for the text.',
    scope: 'docs:read',
    inputSchema: input,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async ({ auth, input: raw }) => {
      const args = input.parse(raw)
      const registered = await deps.registry.roots()
      if (registered.length === 0) return { documents: [], note: 'no documents are registered' }
      const roots = selectCollection(registered, args.collection)
      const { files, incomplete, failed } = await listInRoots(
        deps.drive,
        auth.subject,
        roots,
        `fullText contains '${driveString(args.query)}'`,
        args.limit,
      )
      return {
        ...(incomplete || failed.length > 0 ? { partial: true } : {}),
        ...(failed.length > 0 ? { failed } : {}),
        documents: files.map(f => ({
          id: f.id,
          title: f.name,
          collection: rootOf(f, roots)?.title ?? null,
          modified: f.modifiedTime,
          link: f.webViewLink,
        })),
      }
    },
  }
}
