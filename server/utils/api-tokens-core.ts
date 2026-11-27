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

// Paths a read-only caller must never reach even via GET — shared by both
// read-scope API tokens and viewer sessions (see server/middleware/auth.ts).
// /api/backup exports secrets; /api/users exposes/manages viewer accounts;
// /api/tokens exposes the API token inventory; /api/totp exposes 2FA status.
// /api/settings holds per-host proxy passwords and alert webhook URLs (which embed
// their tokens); /api/env returns container environments (database passwords and
// the like). /api/containers/file(s) reads any file in a mounted path, including
// homeport's own /data/auth.json and so its session secret: a read token there was
// one request away from a forged admin cookie.
// (Token/user management is blocked for ALL bearer tokens separately, in the
// middleware — this list is what keeps a read-scope token or a viewer session
// from even *listing* them.)
const READ_DENY = [
  '/api/backup',
  '/api/users',
  '/api/tokens',
  '/api/totp',
  '/api/settings',
  '/api/env',
  '/api/containers/file',
  '/api/containers/files',
  // the status page preview: the page an admin is preparing, shown even while it is off
  '/api/status-page',
]

// Stack file contents: the compose file (GET /api/stacks/<name>) and anything in the
// stack's folder (/file, /files). These hold inline passwords and the stack's .env,
// the same secrets /api/env keeps from read-only callers for running containers.
// Juniper's call (2026-11-25): viewers see stacks, status, mounts and logs, not files.
// Patterns, not prefixes: /api/stacks, /mounts and /git stay readable.
// A stack's deploy-on-push settings carry its webhook URL, half of what a sender
// needs (the other half, the secret, is never readable at all).
const READ_DENY_PATTERNS = [/^\/api\/stacks\/[^/]+\/?$/, /^\/api\/stacks\/[^/]+\/files?\/?$/, /^\/api\/stacks\/[^/]+\/webhook\/?$/]

// The MCP endpoint is the one POST a read-only caller may make: the protocol sends
// every question as a POST, and its tools (server/utils/mcp-tools-core.ts) only read
// what GET already serves a read token. Exactly this path and only POST: a read token
// still cannot POST, PUT or DELETE anywhere else, /api/mcp/<anything> included.
export const MCP_PATH = '/api/mcp'

/** May a token of this scope perform (method, path)? full = everything. */
export function scopeAllows(scope: TokenScope, method: string, path: string): boolean {
  if (scope === 'full') return true
  const m = (method || '').toUpperCase()
  if (m === 'POST' && path === MCP_PATH) return true
  if (m !== 'GET' && m !== 'HEAD') return false // read tokens are read-only
  if (READ_DENY_PATTERNS.some((re) => re.test(path))) return false
  return !READ_DENY.some((p) => path === p || path.startsWith(`${p}/`))
}

/**
 * The API tokens from a backup file: only the hashes travel (the tokens
 * themselves were shown once and never stored), so scripts using them keep
 * working after a restore. Kept only in the shapes mintToken makes; duplicates
 * (by id or by hash) keep the first.
 */
export function sanitizeTokensBackup(data: unknown): ApiTokenRecord[] {
  if (!Array.isArray(data)) return []
  const out: ApiTokenRecord[] = []
  const seen = new Set<string>()
  for (const raw of data.slice(0, 500)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || !/^[0-9a-f]{12}$/.test(r.id)) continue
    if (typeof r.hash !== 'string' || !/^[0-9a-f]{64}$/.test(r.hash)) continue
    if (r.scope !== 'read' && r.scope !== 'full') continue
    if (seen.has(r.id) || seen.has(r.hash)) continue
    const rec: ApiTokenRecord = {
      id: r.id,
      name: (typeof r.name === 'string' ? r.name.trim().slice(0, 64) : '') || 'token',
      scope: r.scope,
      hash: r.hash,
      prefix: typeof r.prefix === 'string' && r.prefix.startsWith(TOKEN_PREFIX) ? r.prefix.slice(0, 16) : `${TOKEN_PREFIX}…`,
      createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    }
    if (typeof r.lastUsedAt === 'number' && Number.isFinite(r.lastUsedAt)) rec.lastUsedAt = r.lastUsedAt
    seen.add(r.id)
    seen.add(r.hash)
    out.push(rec)
  }
  return out
}
