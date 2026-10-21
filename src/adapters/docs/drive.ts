import { SignJWT, importPKCS8 } from 'jose'
import type { DocsConfig } from './config.js'
import type { RegistryRoot } from './registry.js'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
export const DOC_MIME = 'application/vnd.google-apps.document'
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,webViewLink,driveId,parents,trashed'
const TIMEOUT_MS = 15_000
const TOKEN_TTL_S = 3600
const TOKEN_MARGIN_MS = 60_000
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
  config: DocsConfig
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
  const now = deps.now ?? Date.now
  const tokens = new Map<string, { token: Promise<string>; expiresAt: number }>()
  let key: Promise<CryptoKey | Uint8Array> | null = null

  async function assertion(subject: string): Promise<string> {
    key ??= importPKCS8(deps.config.privateKey, 'RS256').catch(err => {
      key = null
      throw new Error(`GOOGLE_PRIVATE_KEY is not a PKCS8 RSA key: ${err instanceof Error ? err.message : String(err)}`)
    })
    const iat = Math.floor(now() / 1000)
    return new SignJWT({ scope: DRIVE_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(deps.config.serviceAccountEmail)
      .setSubject(subject)
      .setAudience(GOOGLE_TOKEN_URL)
      .setIssuedAt(iat)
      .setExpirationTime(iat + TOKEN_TTL_S)
      .sign(await key)
  }

  async function exchange(subject: string): Promise<{ token: string; expiresIn: number }> {
    const res = await deps.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await assertion(subject),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: unknown
      expires_in?: unknown
      error?: unknown
      error_description?: unknown
    }
    if (!res.ok || typeof body.access_token !== 'string') {
      const code = typeof body.error === 'string' ? body.error : String(res.status)
      const detail = typeof body.error_description === 'string' ? ` ${body.error_description}.` : ''
      throw new Error(
        `google refused to act as ${subject} (${code}).${detail} Check domain wide delegation for ${DRIVE_SCOPE} on the service account client id.`,
      )
    }
    return { token: body.access_token, expiresIn: typeof body.expires_in === 'number' ? body.expires_in : TOKEN_TTL_S }
  }

  function tokenFor(rawSubject: string): Promise<string> {
    const subject = rawSubject.toLowerCase()
    const hit = tokens.get(subject)
    if (hit && hit.expiresAt - TOKEN_MARGIN_MS > now()) return hit.token
    const entry = { token: Promise.resolve(''), expiresAt: now() + TOKEN_TTL_S * 1000 }
    entry.token = exchange(subject).then(
      ({ token, expiresIn }) => {
        entry.expiresAt = now() + expiresIn * 1000
        return token
      },
      err => {
        tokens.delete(subject)
        throw err
      },
    )
    tokens.set(subject, entry)
    return entry.token
  }

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

export function inRoots(file: DriveFile, roots: RegistryRoot[]): boolean {
  return roots.some(root => {
    if (root.kind === 'drive') return file.driveId === root.driveId
    if (root.kind === 'folder') return file.parents.includes(root.driveId)
    return file.id === root.driveId
  })
}
