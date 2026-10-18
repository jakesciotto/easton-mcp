import { createHash, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'
import type { Role } from './store.js'

export const ACCESS_TTL_S = 60 * 60
export const REFRESH_TTL_S = 30 * 24 * 60 * 60
export const CODE_TTL_S = 5 * 60
export const STATE_TTL_S = 10 * 60
const ALG = 'EdDSA'

export interface SigningKeys {
  privateKey: KeyObject
  publicKey: KeyObject
}

export function loadSigningKeys(pem: string): SigningKeys {
  const privateKey = createPrivateKey(pem.replace(/\\n/g, '\n'))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('MCP_JWT_SIGNING_KEY must be an ed25519 PKCS8 key')
  return { privateKey, publicKey: createPublicKey(privateKey) }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  return sha256(verifier) === challenge
}

export interface AccessClaims {
  subject: string
  role: Role
  scopes: string[]
  clientId: string
}

interface Signer {
  keys: SigningKeys
  issuer: string
  audience: string
  now?: () => number
}

const seconds = (now: () => number) => Math.floor(now() / 1000)

export async function mintAccessToken(s: Signer, claims: AccessClaims): Promise<string> {
  const iat = seconds(s.now ?? Date.now)
  return new SignJWT({ role: claims.role, scope: claims.scopes.join(' '), client_id: claims.clientId })
    .setProtectedHeader({ alg: ALG, typ: 'at+jwt' })
    .setIssuer(s.issuer)
    .setAudience(s.audience)
    .setSubject(claims.subject)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_S)
    .sign(s.keys.privateKey)
}

export async function verifyAccessToken(
  s: Signer,
  token: string,
): Promise<(AccessClaims & { expiresAt: number }) | null> {
  try {
    const { payload } = await jwtVerify(token, s.keys.publicKey, {
      issuer: s.issuer,
      audience: s.audience,
      algorithms: [ALG],
      typ: 'at+jwt',
      currentDate: new Date((s.now ?? Date.now)()),
    })
    const role = payload.role
    if (!payload.sub || (role !== 'coach' && role !== 'admin') || typeof payload.client_id !== 'string') {
      return null
    }
    return {
      subject: payload.sub,
      role,
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
      clientId: payload.client_id,
      expiresAt: payload.exp ?? 0,
    }
  } catch {
    return null
  }
}

export async function mintStateToken(s: Signer, payload: JWTPayload, ttl = STATE_TTL_S): Promise<string> {
  const iat = seconds(s.now ?? Date.now)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALG, typ: 'state+jwt' })
    .setIssuer(s.issuer)
    .setAudience(s.issuer)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttl)
    .sign(s.keys.privateKey)
}

export async function verifyStateToken(s: Signer, token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, s.keys.publicKey, {
      issuer: s.issuer,
      audience: s.issuer,
      algorithms: [ALG],
      typ: 'state+jwt',
      currentDate: new Date((s.now ?? Date.now)()),
    })
    return payload
  } catch {
    return null
  }
}
