import { z } from 'zod'
import { pgrstQuote } from './client.js'

export const DIVISIONS = ['kids', 'adults'] as const
export const BELTS = [
  'white', 'grey-white', 'grey', 'grey-black', 'yellow', 'yellow-black', 'orange', 'orange-black',
  'green', 'blue', 'purple', 'brown', 'black',
] as const

export const division = z.enum(DIVISIONS)
export const belt = z.enum(BELTS)
export const text = z.string().trim().min(1).max(100)

export function anyOf(clauses: string[]): [string, string] {
  return ['or', `(${clauses.join(',')})`]
}

export function contains(column: string, value: string): string {
  return `${column}.ilike.${pgrstQuote(`*${value}*`)}`
}

export function equals(column: string, value: string): string {
  return `${column}.eq.${pgrstQuote(value)}`
}

export function latest(rows: { synced_at?: string | null }[]): string | null {
  return rows.reduce<string | null>((max, r) => (r.synced_at && (!max || r.synced_at > max) ? r.synced_at : max), null)
}
