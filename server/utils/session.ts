import { createHmac, timingSafeEqual } from 'node:crypto'
import { getConfig } from './config'

export const SESSION_COOKIE = 'homeport_session'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** Build a signed `<payload>.<hmac>` session token. */
export function createSessionToken(): string {
  const { sessionSecret } = getConfig()
  const payload = Buffer.from(JSON.stringify({ iat: Date.now() })).toString('base64url')
  return `${payload}.${sign(payload, sessionSecret)}`
}

/**
 * Verify a session from a raw Cookie header (WebSocket upgrades bypass the h3
 * middleware, so the terminal handler authenticates explicitly).
 */
export function verifyCookieHeader(header: string | null | undefined): boolean {
  if (!header) return false
  const m = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  return verifySessionToken(m ? decodeURIComponent(m[1]) : undefined)
}

/** Verify signature + freshness of a session token. */
export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false
  const { sessionSecret } = getConfig()
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false

  const expected = sign(payload, sessionSecret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  try {
    const { iat } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof iat === 'number' && Date.now() - iat < MAX_AGE_MS
  } catch {
    return false
  }
}
