import { describe, expect, it } from 'vitest'
import { authConfigFromEnv } from './config.js'

const env = {
  MCP_PUBLIC_URL: 'https://mcp.eastontc.com/',
  MCP_ALLOWED_REDIRECTS: 'https://claude.ai/api/mcp/auth_callback, http://localhost/callback',
  MCP_CIMD_HOSTS: 'claude.ai',
  MCP_ADMIN_GROUP: 'admins@eastontc.com',
}

describe('the auth config reads the environment and names a missing variable', () => {
  it('derives the resource and issuer from the public url', () => {
    const config = authConfigFromEnv(env)
    expect(config.publicUrl).toBe('https://mcp.eastontc.com')
    expect(config.resourceUrl).toBe('https://mcp.eastontc.com/mcp')
    expect(config.allowedRedirects).toHaveLength(2)
  })

  it('names the missing variable', () => {
    expect(() => authConfigFromEnv({ ...env, MCP_ADMIN_GROUP: undefined })).toThrow('MCP_ADMIN_GROUP')
  })

  it('refuses http outside loopback and test', () => {
    expect(() => authConfigFromEnv({ ...env, MCP_PUBLIC_URL: 'http://mcp.eastontc.com' })).toThrow('https')
  })
})
