import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Scoped API tokens for automation (e.g. junibot) — hit the API with a bearer
// token instead of the admin password. Pure (only node:crypto), so it's
// unit-testable in isolation; the fs layer lives in api-tokens.ts.

export type TokenScope = 'read' | 'full'

export interface ApiTokenRecord {
  id: string
  name: string
  scope: TokenScope
  hash: string // sha256(token), hex — the plaintext is shown once and never stored
  prefix: string // first chars of the token, for display ("hp_ab12cd…")
  createdAt: number
  lastUsedAt?: number
}

export const TOKEN_PREFIX = 'hp_'

/** sha256 of a token (hex). Tokens are high-entropy, so a fast hash is right here. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Mint a token: the plaintext (shown ONCE) + the record to persist. */
export function mintToken(name: string, scope: TokenScope, now: number): { token: string; record: ApiTokenRecord } {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`
  return {
    token,
    record: {
      id: randomBytes(6).toString('hex'),
      name: name.trim() || 'token',
      scope: scope === 'full' ? 'full' : 'read',
      hash: hashToken(token),
      prefix: `${token.slice(0, 10)}…`,
      createdAt: now,
    },
  }
}

/** The record matching a presented token, or null. Constant-time on the hash. */
export function matchToken(token: string, records: ApiTokenRecord[]): ApiTokenRecord | null {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null
  const h = Buffer.from(hashToken(token), 'hex')
  for (const r of records) {
    const rh = Buffer.from(r.hash, 'hex')
    if (rh.length === h.length && timingSafeEqual(rh, h)) return r
  }
  return null
}

// Paths a read-only token must never reach even via GET — they export secrets.
// (Token management is blocked for ALL tokens separately, in the middleware.)
const READ_DENY = ['/api/backup']

/** May a token of this scope perform (method, path)? full = everything. */
export function scopeAllows(scope: TokenScope, method: string, path: string): boolean {
  if (scope === 'full') return true
  const m = (method || '').toUpperCase()
  if (m !== 'GET' && m !== 'HEAD') return false // read tokens are read-only
  return !READ_DENY.some((p) => path === p || path.startsWith(`${p}/`))
}
