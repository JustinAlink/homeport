import { createHmac, timingSafeEqual } from 'node:crypto'
import { sessionSecret, currentGeneration } from './auth'

export const SESSION_COOKIE = 'homeport_session'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const PENDING_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes to finish the 2FA step

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** Build a signed `<payload>.<hmac>` session token. `uid` marks a viewer account
 * (its id) — omitted entirely for the admin, so admin sessions are byte-identical
 * to before this ever existed. */
export function createSessionToken(uid?: string): string {
  const body: Record<string, unknown> = { iat: Date.now(), gen: currentGeneration() }
  if (uid) body.uid = uid
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url')
  return `${payload}.${sign(payload, sessionSecret())}`
}

/**
 * A short-lived token proving the password step passed, without granting a
 * session — used for the gap between "password OK" and "2FA code OK" on an
 * account with TOTP enabled. Carries `typ: 'totp-pending'` so it can never be
 * mistaken for (or accepted as) a real session token by verifySessionToken.
 */
export function createPendingTotpToken(): string {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now(), gen: currentGeneration(), typ: 'totp-pending' })).toString('base64url')
  return `${payload}.${sign(payload, sessionSecret())}`
}

export function verifyPendingTotpToken(token: string | undefined): boolean {
  if (!token) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false

  const expected = sign(payload, sessionSecret())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  try {
    const { iat, gen, typ } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typ !== 'totp-pending') return false
    if (typeof iat !== 'number' || Date.now() - iat >= PENDING_MAX_AGE_MS) return false
    return (gen || 0) === currentGeneration()
  } catch {
    return false
  }
}

export interface SessionPayload {
  iat: number
  gen: number
  /** Present only for a viewer account session — its account id. Absent = admin. */
  uid?: string
}

/**
 * Decode + validate a session token's signature, freshness and generation,
 * returning the parsed payload (with an optional `uid`) or null. The single
 * source of truth for what makes a session token valid — verifySessionToken
 * and decodeCookieHeader both build on this.
 */
export function decodeSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null

  const expected = sign(payload, sessionSecret())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const { iat, gen, typ, uid } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typ !== undefined) return null // reject special-purpose tokens (e.g. a totp-pending token)
    if (typeof iat !== 'number' || Date.now() - iat >= MAX_AGE_MS) return null
    // Reject tokens from a superseded generation (password change / logout-everywhere).
    if ((gen || 0) !== currentGeneration()) return null
    return { iat, gen: gen || 0, ...(typeof uid === 'string' && uid ? { uid } : {}) }
  } catch {
    return null
  }
}

/** Verify signature + freshness of a session token. */
export function verifySessionToken(token: string | undefined): boolean {
  return decodeSessionToken(token) !== null
}

/**
 * Decode a session from a raw Cookie header (WebSocket upgrades bypass the h3
 * middleware, so the terminal handler authenticates explicitly).
 */
export function decodeCookieHeader(header: string | null | undefined): SessionPayload | null {
  if (!header) return null
  const m = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  return decodeSessionToken(m ? decodeURIComponent(m[1]) : undefined)
}

/** Verify a session from a raw Cookie header — see decodeCookieHeader. */
export function verifyCookieHeader(header: string | null | undefined): boolean {
  return decodeCookieHeader(header) !== null
}
