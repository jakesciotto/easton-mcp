import type { Directory } from './directory.js'
import type { Role } from './store.js'

export const EVERYONE = '*'

export interface ScopeGrant {
  group: string
  scope: string
}

export interface GrantStore {
  grants(): Promise<ScopeGrant[]>
}

export interface Access {
  role: Role
  scopes: string[]
}

export type ResolveAccess = (email: string) => Promise<Access | null>

export function memoryGrants(rows: ScopeGrant[]): GrantStore {
  return { grants: async () => rows.map(r => ({ group: r.group.toLowerCase(), scope: r.scope })) }
}

export function supabaseGrants(url: string, serviceRoleKey: string, fetchImpl: typeof fetch = fetch): GrantStore {
  return {
    async grants() {
      const res = await fetchImpl(`${url}/rest/v1/scope_grants?select=group_email,scope`, {
        headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`scope grants are unreachable: status ${res.status}`)
      const rows = (await res.json()) as { group_email: string; scope: string }[]
      return rows.map(r => ({ group: r.group_email.toLowerCase(), scope: r.scope }))
    },
  }
}

export function groupAccess(deps: { directory: Directory; grants: GrantStore; adminGroup: string }): ResolveAccess {
  const adminGroup = deps.adminGroup.toLowerCase()
  return async email => {
    const [groups, grants] = await Promise.all([deps.directory.groupsOf(email.toLowerCase()), deps.grants.grants()])
    if (groups === null) return null
    const member = new Set([EVERYONE, ...groups])
    const scopes = [...new Set(grants.filter(g => member.has(g.group)).map(g => g.scope))]
    return { role: groups.includes(adminGroup) ? 'admin' : 'coach', scopes }
  }
}

export function grantedScopes(consented: string[], access: Access): string[] {
  return consented.filter(s => access.scopes.includes(s))
}
