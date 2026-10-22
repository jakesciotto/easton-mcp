import type { ServiceAccount } from '../google/account.js'
import { delegatedTokens } from '../google/delegation.js'

export const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/admin.directory.group.readonly'
export const DIRECTORY_GROUPS_URL = 'https://admin.googleapis.com/admin/directory/v1/groups'
const TIMEOUT_MS = 15_000
const PAGE_LIMIT = 10

export interface Directory {
  groupsOf(email: string): Promise<string[] | null>
}

interface Deps {
  account: ServiceAccount
  adminEmail: string
  fetch: typeof fetch
  now?: () => number
}

export function googleDirectory(deps: Deps): Directory {
  const tokens = delegatedTokens({ account: deps.account, scope: DIRECTORY_SCOPE, fetch: deps.fetch, now: deps.now })
  return {
    async groupsOf(email) {
      const groups: string[] = []
      let pageToken: string | undefined
      for (let page = 0; page < PAGE_LIMIT; page++) {
        const url = new URL(DIRECTORY_GROUPS_URL)
        url.searchParams.set('userKey', email)
        url.searchParams.set('maxResults', '200')
        url.searchParams.set('fields', 'groups(email),nextPageToken')
        if (pageToken) url.searchParams.set('pageToken', pageToken)
        const token = await tokens.tokenFor(deps.adminEmail)
        const res = await deps.fetch(url.href, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (res.status === 404) return null
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: unknown } }
          const message = typeof body.error?.message === 'string' ? body.error.message : `status ${res.status}`
          throw new Error(`directory groups read failed for ${email}: ${message}`)
        }
        const body = (await res.json()) as { groups?: { email?: unknown }[]; nextPageToken?: unknown }
        for (const g of body.groups ?? []) if (typeof g.email === 'string') groups.push(g.email.toLowerCase())
        if (typeof body.nextPageToken !== 'string') return groups
        pageToken = body.nextPageToken
      }
      return groups
    },
  }
}

export const noDirectory: Directory = { groupsOf: async () => [] }
