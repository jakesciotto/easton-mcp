import { generateKeyPairSync } from 'node:crypto'
import { decodeJwt } from 'jose'
import { describe, expect, it } from 'vitest'
import { DELEGATION_TOKEN_URL } from '../google/delegation.js'
import { DIRECTORY_GROUPS_URL, DIRECTORY_SCOPE, googleDirectory } from './directory.js'

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const account = { serviceAccountEmail: 'mcp@easton-mcp.iam.gserviceaccount.com', privateKey }

describe('the directory client reads the groups of a coach as the workspace admin, across pages, and answers null for an unknown account', () => {
  it('holds', async () => {
    const pages: Record<string, { groups: { email: string }[]; nextPageToken?: string }> = {
      'kids@eastontc.com:': { groups: [{ email: 'Kids-Coaches@eastontc.com' }], nextPageToken: 'p2' },
      'kids@eastontc.com:p2': { groups: [{ email: 'staff@eastontc.com' }] },
      'front@eastontc.com:': { groups: [] },
    }
    const assertions: { sub: unknown; scope: unknown }[] = []
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      if (url.href === DELEGATION_TOKEN_URL) {
        const claims = decodeJwt(new URLSearchParams(String(init?.body)).get('assertion')!)
        assertions.push({ sub: claims.sub, scope: claims.scope })
        return Response.json({ access_token: 'admin-token', expires_in: 3600 })
      }
      expect(url.origin + url.pathname).toBe(DIRECTORY_GROUPS_URL)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer admin-token')
      const page = pages[`${url.searchParams.get('userKey')}:${url.searchParams.get('pageToken') ?? ''}`]
      return page ? Response.json(page) : Response.json({ error: { message: 'Resource Not Found: userKey' } }, { status: 404 })
    }
    const directory = googleDirectory({ account, adminEmail: 'Admin@eastontc.com', fetch, now: () => 1_000_000 })
    const expected: [string, string[] | null][] = [
      ['kids@eastontc.com', ['kids-coaches@eastontc.com', 'staff@eastontc.com']],
      ['front@eastontc.com', []],
      ['gone@eastontc.com', null],
    ]
    for (const [email, groups] of expected) expect(await directory.groupsOf(email)).toEqual(groups)
    expect(assertions).toEqual([{ sub: 'admin@eastontc.com', scope: DIRECTORY_SCOPE }])
  })
})
