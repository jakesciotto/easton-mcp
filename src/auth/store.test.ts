import { describe, expect, it } from 'vitest'
import { memoryStore } from './store.js'
import type { StoredCode, StoredRefreshToken } from './store.js'

const code = (expiresAt: string): StoredCode => ({
  codeHash: 'h',
  clientId: 'c',
  subject: 's',
  role: 'coach',
  scopes: [],
  codeChallenge: 'x',
  redirectUri: 'r',
  resource: null,
  expiresAt,
  consumedAt: null,
  createdAt: new Date(0).toISOString(),
})

const token = (tokenHash: string): StoredRefreshToken => ({
  tokenHash,
  familyId: 'f1',
  clientId: 'c',
  subject: 's',
  role: 'coach',
  scopes: [],
  expiresAt: new Date(10_000).toISOString(),
  rotatedAt: null,
  revokedAt: null,
  createdAt: new Date(0).toISOString(),
})

describe('the memory store consumes a code once and rotates a refresh token within its family', () => {
  it('takes a code once and refuses it after expiry', async () => {
    let t = 0
    const store = memoryStore(() => t)
    await store.putCode(code(new Date(1000).toISOString()))
    expect((await store.takeCode('h'))?.consumedAt).not.toBeNull()
    expect(await store.takeCode('h')).toBeNull()
    await store.putCode(code(new Date(1000).toISOString()))
    t = 1000
    expect(await store.takeCode('h')).toBeNull()
  })

  it('rotates a token, keeps the family and revokes the family', async () => {
    const store = memoryStore(() => 5)
    await store.putRefreshToken(token('a'))
    await store.rotateRefreshToken('a', { ...token('b'), familyId: 'other' })
    expect((await store.getRefreshToken('a'))?.rotatedAt).not.toBeNull()
    expect((await store.getRefreshToken('b'))?.familyId).toBe('f1')
    expect(await store.rotateRefreshToken('a', token('c'))).toBe(false)
    await store.revokeFamily('f1')
    expect((await store.getRefreshToken('b'))?.revokedAt).not.toBeNull()
  })
})
