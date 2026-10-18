import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { VERSION } from './app.js'
import { testApp } from './auth/fixtures.js'

const build = () => testApp()

const pkg = createRequire(import.meta.url)('../package.json') as { version: string }

describe('the health route reports the package version', () => {
  it('answers 200 with the version from package.json', async () => {
    const res = await build().request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; version: string; adapters: string[] }
    expect(body.ok).toBe(true)
    expect(body.version).toBe(pkg.version)
    expect(body.adapters).toEqual(['core'])
  })

  it('answers an unknown route with a JSON 404', async () => {
    const res = await build().request('/nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'not found' } })
  })
})

describe('the served version equals the package version', () => {
  it('keeps the VERSION constant equal to the version in package.json', () => {
    expect(VERSION).toBe(pkg.version)
  })
})
