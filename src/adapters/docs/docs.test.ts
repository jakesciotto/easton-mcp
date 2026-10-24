import { generateKeyPairSync } from 'node:crypto'
import { decodeJwt } from 'jose'
import { describe, expect, it } from 'vitest'
import type { AuthContext } from '../../mcp/registry.js'
import { driveString, googleDrive, inRoots } from './drive.js'
import type { DriveFile } from './drive.js'
import { docs } from './index.js'
import { memoryRegistry } from './registry.js'
import type { RegistryRoot } from './registry.js'

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const config = { serviceAccountEmail: 'mcp@easton-mcp.iam.gserviceaccount.com', privateKey }
const coach: AuthContext = { subject: 'coach@eastontc.com', role: 'coach', scopes: ['docs:read'] }

const sops: DriveFile = {
  id: '1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Opening the gym',
  mimeType: 'application/vnd.google-apps.document',
  modifiedTime: '2026-10-01T00:00:00Z',
  webViewLink: 'https://docs.google.com/document/d/1aaa',
  driveId: 'driveSOP',
  parents: ['folderSOP'],
  trashed: false,
}
const stray: DriveFile = { ...sops, id: '1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'Payroll', driveId: 'driveHR', parents: ['folderHR'] }
const longTitle: DriveFile = { ...sops, id: '1cccccccccccccccccccccccccccccccccccccc', name: 'Competition-Day-Checklist-SOP' }
const broken: DriveFile = { ...sops, id: '1dddddddddddddddddddddddddddddddddddddd', name: 'Rate limited' }
const adult: DriveFile = { ...sops, id: '1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', name: 'Opening the adult mat', driveId: 'driveADULT', parents: ['folderADULT'] }
const roots: RegistryRoot[] = [{ driveId: 'driveSOP', kind: 'drive', title: 'SOPs', writable: false }]
const programs: RegistryRoot[] = [...roots, { driveId: 'driveADULT', kind: 'drive', title: 'Adult SOPs', writable: false }]

function fakeGoogle(files: DriveFile[]) {
  const calls: { url: URL; subject: string | null }[] = []
  const tokens = new Map<string, string>()
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin === 'https://oauth2.googleapis.com') {
      const assertion = new URLSearchParams(String(init?.body)).get('assertion')!
      const claims = decodeJwt(assertion)
      const token = `tok-${claims.sub}-${tokens.size}`
      tokens.set(token, String(claims.sub))
      return Response.json({ access_token: token, expires_in: 3600 })
    }
    const auth = new Headers(init?.headers).get('authorization') ?? ''
    const subject = tokens.get(auth.replace('Bearer ', '')) ?? null
    calls.push({ url, subject })
    const parts = url.pathname.split('/')
    if (parts.length === 6 && parts[5] === 'export') {
      const file = files.find(f => f.id === parts[4])
      if (file?.name === 'Rate limited') {
        return Response.json({ error: { message: 'Rate Limit Exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } }, { status: 403 })
      }
      return file ? new Response(`# ${file.name}\n\nbody`) : new Response('', { status: 404 })
    }
    if (parts.length === 5) {
      const file = files.find(f => f.id === parts[4])
      return file ? Response.json(file) : new Response('', { status: 404 })
    }
    const q = url.searchParams.get('q') ?? ''
    const driveId = url.searchParams.get('driveId')
    if (driveId === 'driveLOCKED') {
      return Response.json({ error: { message: 'The user does not have access', errors: [{ reason: 'notFound' }] } }, { status: 404 })
    }
    if (driveId === 'driveDOWN') {
      return Response.json({ error: { message: 'Backend Error', errors: [{ reason: 'backendError' }] } }, { status: 500 })
    }
    const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1')
    const hits = files.filter(f => (driveId ? f.driveId === driveId : true) && (name ? f.name === name : true))
    return Response.json({ files: hits, incompleteSearch: driveId === 'driveADULT' })
  }
  return { fetch, calls }
}

function adapter(files: DriveFile[], registry: RegistryRoot[], now = () => 1_000_000) {
  const google = fakeGoogle(files)
  const drive = googleDrive({ config, fetch: google.fetch, now })
  const a = docs({ drive, registry: memoryRegistry(registry) })
  const tool = (name: string) => a.tools.find(t => t.name === name)!
  return { drive, calls: google.calls, tool }
}

describe('docs_search returns only documents inside a registered root and nothing when the registry is empty', () => {
  it('holds', async () => {
    const { tool, calls } = adapter([sops, stray], roots)
    const res = (await tool('docs_search').handler({ auth: coach, input: { query: 'opening' } })) as { documents: { id: string }[] }
    expect(res.documents.map(d => d.id)).toEqual([sops.id])
    expect(calls).toHaveLength(1)
    expect(calls[0].url.searchParams.get('driveId')).toBe('driveSOP')
    expect(calls[0].url.searchParams.get('q')).toContain("fullText contains 'opening'")
    const empty = adapter([sops, stray], [])
    const none = (await empty.tool('docs_search').handler({ auth: coach, input: { query: 'opening' } })) as { documents: unknown[] }
    expect(none.documents).toEqual([])
    expect(empty.calls).toHaveLength(0)
  })
})

describe('a collection filter searches only that root, every result names its collection and docs_list answers the registered collections', () => {
  it('holds', async () => {
    const { tool, calls } = adapter([sops, adult, stray], programs)
    type Hit = { id: string; collection: string | null }
    const both = (await tool('docs_search').handler({ auth: coach, input: { query: 'opening' } })) as { documents: Hit[] }
    expect(both.documents.map(d => [d.id, d.collection])).toEqual([
      [sops.id, 'SOPs'],
      [adult.id, 'Adult SOPs'],
    ])
    expect(calls).toHaveLength(2)
    const only = (await tool('docs_search').handler({ auth: coach, input: { query: 'opening', collection: 'adult sops' } })) as { documents: Hit[] }
    expect(only.documents.map(d => [d.id, d.collection])).toEqual([[adult.id, 'Adult SOPs']])
    expect(calls).toHaveLength(3)
    expect(calls[2].url.searchParams.get('driveId')).toBe('driveADULT')
    await expect(tool('docs_search').handler({ auth: coach, input: { query: 'opening', collection: 'Teens' } })).rejects.toThrow(
      'collection "Teens" is not registered; registered collections: SOPs, Adult SOPs',
    )
    expect(calls).toHaveLength(3)
    const read = (await tool('docs_read').handler({ auth: coach, input: { names: [adult.id] } })) as { documents: { collection: string | null }[] }
    expect(read.documents[0].collection).toBe('Adult SOPs')
    const list = (await tool('docs_list').handler({ auth: coach, input: {} })) as { collections: { name: string; id: string; kind: string }[] }
    expect(list.collections).toEqual([
      { name: 'SOPs', id: 'driveSOP', kind: 'drive' },
      { name: 'Adult SOPs', id: 'driveADULT', kind: 'drive' },
    ])
  })
})

describe('docs_read exports a document as markdown only when it sits in a registered root', () => {
  it('holds', async () => {
    const { tool } = adapter([sops, stray], roots)
    const res = (await tool('docs_read').handler({ auth: coach, input: { names: [sops.id, 'Opening the gym', stray.id, 'Payroll'] } })) as {
      documents: { name: string; found: boolean; markdown?: string }[]
    }
    expect(res.documents.map(d => d.found)).toEqual([true, true, false, false])
    expect(res.documents[0].markdown).toBe('# Opening the gym\n\nbody')
    expect(res.documents[1].markdown).toBe('# Opening the gym\n\nbody')
  })
})

describe('docs_read answers each name on its own, keeps a drive failure to its name and reads a long title as a title', () => {
  it('holds', async () => {
    const { tool } = adapter([sops, longTitle, broken], roots)
    const res = (await tool('docs_read').handler({ auth: coach, input: { names: ['Competition-Day-Checklist-SOP', broken.id, sops.id] } })) as {
      documents: { found: boolean; reason?: string; title?: string }[]
    }
    expect(res.documents.map(d => d.found)).toEqual([true, false, true])
    expect(res.documents[0].title).toBe('Competition-Day-Checklist-SOP')
    expect(res.documents[1].reason).toMatch(/userRateLimitExceeded.*retry this name/)
  })
})

describe('the drive client acts as the signed in coach and reuses the token until it expires', () => {
  it('holds', async () => {
    let t = 1_000_000
    const { drive, calls } = adapter([sops], roots, () => t)
    await drive.get(coach.subject, sops.id)
    await drive.get(coach.subject, sops.id)
    await drive.get('other@eastontc.com', sops.id)
    expect(calls.map(c => c.subject)).toEqual([coach.subject, coach.subject, 'other@eastontc.com'])
    const first = await drive.tokenFor(coach.subject)
    t += 3600 * 1000
    expect(await drive.tokenFor(coach.subject)).not.toBe(first)
  })
})

describe('a coach string is quoted so it cannot change the drive filter', () => {
  it('holds', () => {
    expect(driveString("a' or name != 'x")).toBe("a\\' or name != \\'x")
    expect(driveString('back\\slash')).toBe('back\\\\slash')
    expect(inRoots(sops, [{ driveId: 'folderSOP', kind: 'folder', title: 'f', writable: false }])).toBe(true)
    expect(inRoots(stray, roots)).toBe(false)
  })
})

describe('a collection that fails in Drive leaves the others answering and marks the search partial', () => {
  it('holds', async () => {
    const down: RegistryRoot = { driveId: 'driveDOWN', kind: 'drive', title: 'Down SOPs', writable: false }
    const locked: RegistryRoot = { driveId: 'driveLOCKED', kind: 'drive', title: 'Locked SOPs', writable: false }
    const { tool } = adapter([sops, adult], [...roots, down, locked])
    const res = (await tool('docs_search').handler({ auth: coach, input: { query: 'opening' } })) as {
      partial?: boolean
      failed?: { collection: string; reason: string }[]
      documents: { id: string }[]
    }
    expect(res.documents.map(d => d.id)).toEqual([sops.id])
    expect(res.partial).toBe(true)
    expect(res.failed).toEqual([{ collection: 'Down SOPs', reason: 'Drive did not answer for this collection; retry later' }])
    expect(JSON.stringify(res)).not.toContain('Backend Error')

    const lockedOnly = (await adapter([sops], [...roots, locked]).tool('docs_search').handler({ auth: coach, input: { query: 'opening' } })) as Record<string, unknown>
    expect(lockedOnly).not.toHaveProperty('partial')

    const clean = (await adapter([sops], roots).tool('docs_search').handler({ auth: coach, input: { query: 'opening' } })) as Record<string, unknown>
    expect(clean).not.toHaveProperty('partial')
    expect(clean).not.toHaveProperty('failed')

    const cut = (await adapter([adult], programs).tool('docs_search').handler({ auth: coach, input: { query: 'opening' } })) as Record<string, unknown>
    expect(cut).toMatchObject({ partial: true })
    expect(cut).not.toHaveProperty('failed')

    const allDown = adapter([sops], [down])
    await expect(allDown.tool('docs_search').handler({ auth: coach, input: { query: 'opening' } })).rejects.toThrow(/backendError/)

    const half = adapter([sops, adult], [...programs, down])
    const read = (await half.tool('docs_read').handler({ auth: coach, input: { names: ['Opening the gym', 'Missing SOP'] } })) as {
      documents: { name: string; found: boolean; reason?: string }[]
    }
    expect(read.documents[0]).toMatchObject({ name: 'Opening the gym', found: true })
    expect(read.documents[1]).toMatchObject({ found: false, reason: expect.stringContaining('Down SOPs did not answer') })
  })
})
