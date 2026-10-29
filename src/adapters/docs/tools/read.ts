import { z } from 'zod'
import { RESULT_CAP } from '../../../mcp/registry.js'
import type { ToolDef } from '../../../mcp/registry.js'
import { driveString, inRoots, isReadableDoc, listInRoots, rootOf } from '../drive.js'
import type { DriveClient, DriveFile } from '../drive.js'
import type { DocumentRegistry, RegistryRoot } from '../registry.js'

const DRIVE_ID = /^[A-Za-z0-9_-]{20,}$/
const BUDGET = Math.floor(RESULT_CAP * 0.6)

const input = z.object({
  names: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
})

type Resolved = { file: DriveFile } | { reason: string }

async function byTitle(
  drive: DriveClient,
  subject: string,
  roots: RegistryRoot[],
  title: string,
): Promise<{ files: DriveFile[]; failed: string[] }> {
  const docs = roots.filter(r => r.kind === 'doc')
  const [listed, single] = await Promise.all([
    listInRoots(drive, subject, roots, `name = '${driveString(title)}'`, 2),
    Promise.all(docs.map(d => drive.get(subject, d.driveId))),
  ])
  const named = single.filter((f): f is DriveFile => f !== null && f.name === title && isReadableDoc(f))
  const seen = new Set<string>()
  const files = [...listed.files, ...named].filter(f => !seen.has(f.id) && seen.add(f.id))
  return { files, failed: listed.failed.map(f => f.collection) }
}

async function resolve(drive: DriveClient, subject: string, roots: RegistryRoot[], name: string): Promise<Resolved> {
  if (DRIVE_ID.test(name)) {
    const file = await drive.get(subject, name)
    if (file && inRoots(file, roots)) {
      return isReadableDoc(file) ? { file } : { reason: 'this id is not a Google Doc or sits in the trash' }
    }
  }
  const { files: matches, failed } = await byTitle(drive, subject, roots, name)
  if (matches.length > 1)
    return { reason: 'more than one registered document has this title, pass the id from docs_search' }
  if (matches[0]) return { file: matches[0] }
  if (failed.length > 0)
    return { reason: `no answering collection holds this title; ${failed.join(', ')} did not answer, retry later` }
  return { reason: 'no registered document matches this id or title' }
}

export function docsRead(deps: { drive: DriveClient; registry: DocumentRegistry }): ToolDef {
  return {
    name: 'docs_read',
    title: 'Read SOP documents',
    description:
      'Read one to five registered Easton SOP Google Docs as markdown. Pass document ids from docs_search or exact titles. Call it when the coach asks what an SOP says, or after docs_search found the document. A document outside the registry, or one the coach cannot open in Drive, answers found false with the reason.',
    scope: 'docs:read',
    inputSchema: input,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async ({ auth, input: raw }) => {
      const args = input.parse(raw)
      const roots = await deps.registry.roots()
      const perDoc = Math.floor(BUDGET / args.names.length)
      const documents = await Promise.all(
        args.names.map(async name => {
          try {
            if (roots.length === 0) return { name, found: false, reason: 'no documents are registered' }
            const resolved = await resolve(deps.drive, auth.subject, roots, name)
            if (!('file' in resolved)) return { name, found: false, reason: resolved.reason }
            const text = await deps.drive.exportMarkdown(auth.subject, resolved.file.id)
            if (text === null) return { name, found: false, reason: 'the coach cannot open this document in Drive' }
            return {
              name,
              found: true,
              id: resolved.file.id,
              title: resolved.file.name,
              collection: rootOf(resolved.file, roots)?.title ?? null,
              modified: resolved.file.modifiedTime,
              link: resolved.file.webViewLink,
              truncated: text.length > perDoc,
              markdown: text.slice(0, perDoc),
            }
          } catch (err) {
            return {
              name,
              found: false,
              reason: `${err instanceof Error ? err.message : String(err)}; retry this name`,
            }
          }
        }),
      )
      return { documents }
    },
  }
}
