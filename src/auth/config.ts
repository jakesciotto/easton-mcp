export interface AuthConfig {
  publicUrl: string
  resourceUrl: string
  issuer: string
  allowedRedirects: string[]
  cimdHosts: string[]
  scopes: string[]
  adminGroup: string
}

export interface StateConfig {
  url: string
  serviceRoleKey: string
}

const SCOPES = ['leaderboard:read', 'docs:read', 'leaderboard:write', 'docs:write', 'offline_access']
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1']

type Env = Record<string, string | undefined>

function required(env: Env, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`missing environment variable ${name}`)
  return value
}

function list(env: Env, name: string): string[] {
  return required(env, name)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function publicUrl(env: Env): string {
  const raw = required(env, 'MCP_PUBLIC_URL').replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('MCP_PUBLIC_URL is not a URL')
  }
  const relaxed = env.NODE_ENV === 'test' || LOOPBACK_HOSTS.includes(url.hostname)
  if (url.protocol !== 'https:' && !(relaxed && url.protocol === 'http:')) {
    throw new Error('MCP_PUBLIC_URL must use https')
  }
  return raw
}

export function authConfigFromEnv(env: Env): AuthConfig {
  const base = publicUrl(env)
  return {
    publicUrl: base,
    resourceUrl: `${base}/mcp`,
    issuer: base,
    allowedRedirects: list(env, 'MCP_ALLOWED_REDIRECTS'),
    cimdHosts: list(env, 'MCP_CIMD_HOSTS'),
    scopes: [...SCOPES],
    adminGroup: required(env, 'MCP_ADMIN_GROUP'),
  }
}

export function stateConfigFromEnv(env: Env): StateConfig {
  return {
    url: required(env, 'MCP_SUPABASE_URL'),
    serviceRoleKey: required(env, 'MCP_SUPABASE_SERVICE_ROLE_KEY'),
  }
}

export function portFromEnv(env: Env): number {
  return Number(env.PORT ?? 8787)
}

export interface GoogleEnvConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  hostedDomain: string
}

export const HOSTED_DOMAIN = 'eastontc.com'

export function googleConfigFromEnv(env: Env): GoogleEnvConfig {
  return {
    clientId: required(env, 'GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: required(env, 'GOOGLE_OAUTH_CLIENT_SECRET'),
    redirectUri: `${publicUrl(env)}/oauth/google/callback`,
    hostedDomain: HOSTED_DOMAIN,
  }
}

export function signingKeyFromEnv(env: Env): string {
  return required(env, 'MCP_JWT_SIGNING_KEY')
}
