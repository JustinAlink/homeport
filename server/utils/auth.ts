import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { settingsWritable } from './settings'
import { hashPassword, verifyHash, constantEquals, MIN_PASSWORD_LENGTH } from './auth-core'

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
}

const file = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'auth.json')
const envPassword = () => process.env.HOMEPORT_ADMIN_PASSWORD || ''
const envSecret = () => process.env.HOMEPORT_SESSION_SECRET || ''

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
  write({ passwordHash: hashPassword(plain), authSkipped: false })
}

/** Record that the user chose to run without a login. */
export function skipAuth(): void {
  if (settingsWritable()) write({ authSkipped: true })
}

export type AuthMode = 'enforced' | 'setup' | 'open'

/**
 * - enforced: a password is configured → a valid session is required.
 * - setup:    no password, data dir writable, not skipped → force first-run setup.
 * - open:     no password and (skipped OR read-only volume) → no auth (with a warning).
 */
export function authMode(): AuthMode {
  if (hasPassword()) return 'enforced'
  if (read().authSkipped || !settingsWritable()) return 'open'
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
  if (!memorySecret) memorySecret = randomBytes(32).toString('hex')
  return memorySecret
}
