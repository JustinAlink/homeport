import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { settingsWritable } from './settings'
import { hashPassword, verifyHash, constantEquals, MIN_PASSWORD_LENGTH } from './auth-core'
import { warnOnce } from './log'

// Admin auth resolution, in priority order:
//   1. HOMEPORT_ADMIN_PASSWORD env  → headless / locked (env always wins)
//   2. a persisted password hash    → set via the in-app first-run setup
//   3. nothing                      → first-run setup (if the data dir is writable),
//                                      or "open" (no auth) if the user skipped it
//                                      or the volume is read-only.
//
// The session-signing secret is HOMEPORT_SESSION_SECRET, else a random one
// generated once and persisted here (so a bare `docker run` is still secure).

interface AuthFile {
  passwordHash?: string
  sessionSecret?: string
  authSkipped?: boolean // user chose to run without a login
  sessionGeneration?: number // bumped to revoke all outstanding sessions
}

const file = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'auth.json')
const envPassword = () => process.env.HOMEPORT_ADMIN_PASSWORD || ''
const envSecret = () => process.env.HOMEPORT_SESSION_SECRET || ''
const envAllowOpen = () => process.env.HOMEPORT_ALLOW_OPEN === 'true' || process.env.HOMEPORT_ALLOW_OPEN === '1'

/**
 * Forward-auth header name (env-only). When set, homeport trusts an upstream
 * proxy (Authelia / Authentik / oauth2-proxy / …) to authenticate the user and
 * pass their name in this header. Empty = off. SECURITY: only safe when
 * homeport is reachable ONLY through that proxy — a directly-reachable instance
 * lets any client forge the header. See auth-core `forwardAuthUser`.
 */
export function trustedAuthHeader(): string {
  return (process.env.HOMEPORT_TRUSTED_HEADER || '').trim()
}

let cache: AuthFile | null = null
let memorySecret = '' // fallback secret when the data dir isn't writable

function read(): AuthFile {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache!
}

function write(patch: AuthFile): AuthFile {
  const next = { ...read(), ...patch }
  const dir = process.env.HOMEPORT_DATA_DIR || '/data'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 })
  cache = next
  return next
}

/** Raw auth file for backup export (hash + session secret — treat as sensitive). */
export function exportAuthFile(): AuthFile {
  return { ...read() }
}

/** Replace the auth file wholesale (backup restore). Invalidates existing sessions. */
export function restoreAuthFile(data: AuthFile): void {
  const next: AuthFile = {}
  if (typeof data.passwordHash === 'string') next.passwordHash = data.passwordHash
  if (typeof data.sessionSecret === 'string') next.sessionSecret = data.sessionSecret
  if (typeof data.authSkipped === 'boolean') next.authSkipped = data.authSkipped
  if (typeof data.sessionGeneration === 'number') next.sessionGeneration = data.sessionGeneration
  const dir = process.env.HOMEPORT_DATA_DIR || '/data'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 })
  cache = next
}

/** Is an admin password configured (env or persisted)? */
export function hasPassword(): boolean {
  return !!envPassword() || !!read().passwordHash
}

/** Verify a supplied password against the env value or the persisted hash. */
export function verifyPassword(plain: string): boolean {
  const env = envPassword()
  if (env) return constantEquals(plain, env)
  return verifyHash(plain, read().passwordHash)
}

/** Persist a new admin password hash (in-app setup / change). Env password wins. */
export function setPassword(plain: string): void {
  if (envPassword()) throw new Error('password is set via HOMEPORT_ADMIN_PASSWORD (env) — change it there')
  if (!plain || plain.length < MIN_PASSWORD_LENGTH) throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  if (!settingsWritable()) throw new Error('cannot save: the data volume is not writable')
  // Bump the session generation so any cookie issued under the old password stops
  // validating — a password change is the natural "I might be compromised" response.
  const gen = (read().sessionGeneration || 0) + 1
  write({ passwordHash: hashPassword(plain), authSkipped: false, sessionGeneration: gen })
}

/** Record that the user chose to run without a login. */
export function skipAuth(): void {
  if (settingsWritable()) write({ authSkipped: true })
}

/** Current session generation — mixed into every token so it can be revoked. */
export function currentGeneration(): number {
  return read().sessionGeneration || 0
}

/** Invalidate ALL outstanding session tokens (logout-everywhere / password change). */
export function bumpGeneration(): number {
  const next = (read().sessionGeneration || 0) + 1
  if (settingsWritable()) {
    write({ sessionGeneration: next })
  } else {
    // read-only volume: hold it in memory so it still revokes within this process
    cache = { ...read(), sessionGeneration: next }
  }
  return next
}

export type AuthMode = 'enforced' | 'setup' | 'open'

/**
 * - enforced: a password is configured → a valid session is required.
 * - open:     no password AND the operator explicitly opted out of auth
 *             (chose "skip" in first-run setup, or set HOMEPORT_ALLOW_OPEN).
 * - setup:    no password and no explicit opt-out → force first-run setup.
 *
 * Fail-closed: a read-only data volume (can't persist a password) no longer
 * silently drops to open mode — it stays in `setup`, which keeps the API 401'd
 * until the operator sets HOMEPORT_ADMIN_PASSWORD, fixes the volume, or opts in
 * with HOMEPORT_ALLOW_OPEN=true.
 */
export function authMode(): AuthMode {
  if (hasPassword()) return 'enforced'
  if (read().authSkipped || envAllowOpen()) return 'open'
  return 'setup'
}

/** Effective HMAC secret for session cookies; generated + persisted on first use. */
export function sessionSecret(): string {
  const env = envSecret()
  if (env) return env
  const persisted = read().sessionSecret
  if (persisted) return persisted
  if (settingsWritable()) return write({ sessionSecret: randomBytes(32).toString('hex') }).sessionSecret!
  // read-only volume: stable for this process only (sessions won't survive a restart)
  if (!memorySecret) {
    memorySecret = randomBytes(32).toString('hex')
    warnOnce('session-ro', 'auth', 'data dir is not writable — the session secret is process-local, so logins drop on every restart (set HOMEPORT_SESSION_SECRET to fix)')
  }
  return memorySecret
}
