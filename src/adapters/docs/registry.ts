import { createClient } from '@supabase/supabase-js'

export type RootKind = 'drive' | 'folder' | 'doc' | 'sheet' | 'slides'

export interface RegistryRoot {
  driveId: string
  kind: RootKind
  title: string
  writable: boolean
}

export interface DocumentRegistry {
  roots(): Promise<RegistryRoot[]>
}

export const REGISTRY_TTL_MS = 300_000

export function memoryRegistry(rows: RegistryRoot[]): DocumentRegistry {
  return { roots: async () => rows.slice() }
}

export function supabaseRegistry(url: string, serviceRoleKey: string, now: () => number = Date.now): DocumentRegistry {
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  let cached: { at: number; rows: RegistryRoot[] } | null = null
  return {
    async roots() {
      if (cached && now() - cached.at < REGISTRY_TTL_MS) return cached.rows
      const { data, error } = await db
        .from('documents')
        .select('drive_id, kind, title, writable')
        .is('removed_at', null)
      if (error) throw new Error(`document registry is unreachable: ${error.message}`)
      const rows = (data ?? []).map(r => ({
        driveId: r.drive_id as string,
        kind: r.kind as RootKind,
        title: r.title as string,
        writable: r.writable as boolean,
      }))
      cached = { at: now(), rows }
      return rows
    },
  }
}
