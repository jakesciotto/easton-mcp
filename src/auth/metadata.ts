import type { OAuthMetadata, OAuthProtectedResourceMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { AuthConfig } from './config.js'

export function authorizationServerMetadata(config: AuthConfig): OAuthMetadata {
  const base: OAuthMetadata = {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    registration_endpoint: `${config.issuer}/oauth/register`,
    revocation_endpoint: `${config.issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: config.scopes,
  }
  return { ...base, client_id_metadata_document_supported: true } as OAuthMetadata
}

export function protectedResourceMetadata(config: AuthConfig): OAuthProtectedResourceMetadata {
  return {
    resource: config.resourceUrl,
    authorization_servers: [config.issuer],
    scopes_supported: config.scopes.filter(s => s !== 'offline_access'),
    bearer_methods_supported: ['header'],
    resource_name: 'Easton MCP',
  }
}
