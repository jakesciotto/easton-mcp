import type { ServiceAccount } from '../../google/account.js'
import { delegatedTokens } from '../../google/delegation.js'
import type { RegistryRoot } from './registry.js'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
export const DOC_MIME = 'application/vnd.google-apps.document'
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,webViewLink,driveId,parents,trashed'
const TIMEOUT_MS = 15_000
const NO_ACCESS = new Set(['forbidden', 'insufficientFilePermissions', 'notFound', 'fileNotFound'])

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  webViewLink: string | null
  driveId: string | null
  parents: string[]
  trashed: boolean
}

export interface DriveClient {
  tokenFor(subject: string): Promise<string>
  list(subject: string, params: Record<string, string>): Promise<DriveFile[]>
  get(subject: string, id: string): Promise<DriveFile | null>
  exportMarkdown(subject: string, id: string): Promise<string | null>
}

interface Deps {
  config: ServiceAccount
  fetch: typeof fetch
  now?: () => number
}

export function driveString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function toFile(raw: Record<string, unknown>): DriveFile {
  return {
    id: String(raw.id),
    name: String(raw.name),
    mimeType: String(raw.mimeType),
    modifiedTime: String(raw.modifiedTime),
    webViewLink: typeof raw.webViewLink === 'string' ? raw.webViewLink : null,
    driveId: typeof raw.driveId === 'string' ? raw.driveId : null,
    parents: Array.isArray(raw.parents) ? raw.parents.map(String) : [],
    trashed: raw.trashed === true,
  }
}

async function driveError(res: Response, action: string): Promise<{ reason: string; error: Error }> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: unknown; errors?: { reason?: unknown }[] } }
  const reason = typeof body.error?.errors?.[0]?.reason === 'string' ? body.error.errors[0].reason : String(res.status)
  const message = typeof body.error?.message === 'string' ? body.error.message : `status ${res.status}`
  return { reason, error: new Error(`drive ${action} failed (${reason}): ${message}`) }
}

export function googleDrive(deps: Deps): DriveClient {
  const { tokenFor } = delegatedTokens({ account: deps.config, scope: DRIVE_SCOPE, fetch: deps.fetch, now: deps.now })

  async function call(subject: string, url: string): Promise<Response> {
    const token = await tokenFor(subject)
    return deps.fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  }

  return {
    tokenFor,
    async list(subject, params) {
      const url = new URL(DRIVE_FILES_URL)
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      url.searchParams.set('fields', `files(${FILE_FIELDS})`)
      const res = await call(subject, url.href)
      if (!res.ok) throw (await driveError(res, 'search')).error
      const body = (await res.json()) as { files?: Record<string, unknown>[] }
      return (body.files ?? []).map(toFile)
    },
    async get(subject, id) {
      const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(id)}`)
      url.searchParams.set('fields', FILE_FIELDS)
      url.searchParams.set('supportsAllDrives', 'true')
      const res = await call(subject, url.href)
      if (res.ok) return toFile((await res.json()) as Record<string, unknown>)
      const { reason, error } = await driveError(res, 'read')
      if (res.status === 404 || NO_ACCESS.has(reason)) return null
      throw error
    },
    async exportMarkdown(subject, id) {
      const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(id)}/export`)
      url.searchParams.set('mimeType', 'text/markdown')
      const res = await call(subject, url.href)
      if (res.ok) return res.text()
      const { reason, error } = await driveError(res, 'export')
      if (res.status === 404 || NO_ACCESS.has(reason)) return null
      throw error
    },
  }
}

export function isReadableDoc(file: DriveFile): boolean {
  return file.mimeType === DOC_MIME && !file.trashed
}

export async function listInRoots(
  drive: DriveClient,
  subject: string,
  roots: RegistryRoot[],
  clause: string,
  limit: number,
): Promise<DriveFile[]> {
  const base = `${clause} and mimeType = '${DOC_MIME}' and trashed = false`
  const shared = { pageSize: String(limit), includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' }
  const calls: Promise<DriveFile[]>[] = []
  const folders = roots.filter(r => r.kind === 'folder')
  if (folders.length > 0) {
    const parents = folders.map(f => `'${driveString(f.driveId)}' in parents`).join(' or ')
    calls.push(drive.list(subject, { ...shared, corpora: 'allDrives', q: `${base} and (${parents})` }))
  }
  for (const root of roots.filter(r => r.kind === 'drive')) {
    calls.push(drive.list(subject, { ...shared, corpora: 'drive', driveId: root.driveId, q: base }))
  }
  const seen = new Set<string>()
  const files: DriveFile[] = []
  for (const file of (await Promise.all(calls)).flat()) {
    if (seen.has(file.id)) continue
    seen.add(file.id)
    files.push(file)
  }
  return files.slice(0, limit)
}

export function rootOf(file: DriveFile, roots: RegistryRoot[]): RegistryRoot | undefined {
  return roots.find(root => {
    if (root.kind === 'drive') return file.driveId === root.driveId
    if (root.kind === 'folder') return file.parents.includes(root.driveId)
    return file.id === root.driveId
  })
}

export function inRoots(file: DriveFile, roots: RegistryRoot[]): boolean {
  return rootOf(file, roots) !== undefined
}
