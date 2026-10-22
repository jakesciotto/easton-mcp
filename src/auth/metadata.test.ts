import { describe, expect, it } from 'vitest'
import { testApp } from './fixtures.js'

const app = testApp()

describe('the protected resource metadata names the mcp path as the resource and one issuer', () => {
  it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])(
    'serves %s',
    async path => {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.resource).toBe('https://mcp.eastontc.com/mcp')
      expect(body.authorization_servers).toEqual(['https://mcp.eastontc.com'])
      expect(body.scopes_supported).not.toContain('offline_access')
    },
  )
})

describe('the authorization server metadata advertises S256, the none auth method and CIMD support', () => {
  it.each(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'])(
    'serves %s',
    async path => {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.issuer).toBe('https://mcp.eastontc.com')
      expect(body.code_challenge_methods_supported).toEqual(['S256'])
      expect(body.token_endpoint_auth_methods_supported).toContain('none')
      expect(body.client_id_metadata_document_supported).toBe(true)
      expect(body.authorization_response_iss_parameter_supported).toBe(true)
      expect(body.registration_endpoint).toBe('https://mcp.eastontc.com/oauth/register')
      expect(body.scopes_supported).toContain('offline_access')
    },
  )
})
