import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { hashPassword, verifyHash, MIN_PASSWORD_LENGTH } from './auth-core'
import { mintUser, normalizeUsername, validateUsername, type UserRecord } from './users-core'
import { usernameFromClaims, uniqueUsername } from './oidc-core'

// A fixed decoy hash so a nonexistent username still pays the same scrypt
// cost as a real one below — otherwise the lookup miss short-circuits well
// before verifyHash runs, a timing side-channel that leaks which usernames exist.
const DECOY_HASH = hashPassword(randomBytes(32).toString('hex'))

// Persistence for secondary accounts (<data>/users.json, 0600): read-only viewers,
// and SSO accounts (viewer or admin, as their groups say). Only hashes are stored,
// plaintext passwords are never persisted or logged.

const file = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'users.json')

let cache: UserRecord[] | null = null

function read(): UserRecord[] {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8'))
    cache = Array.isArray(parsed) ? parsed : []
  } catch {
    cache = []
  }
  return cache!
}

function persist(records: UserRecord[]): void {
  cache = records
  try {
    const dir = process.env.HOMEPORT_DATA_DIR || '/data'
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(file(), JSON.stringify(records, null, 2), { mode: 0o600 })
  } catch {
    // read-only volume: accounts live in-process only (won't survive a restart)
  }
}

/** Viewer account metadata for the settings list — never the hash. */
export function listUsers(): Omit<UserRecord, 'hash'>[] {
  return read().map(({ hash, ...meta }) => meta)
}

/** A single viewer account's metadata (never the hash), or null. */
export function getUser(id: string): Omit<UserRecord, 'hash'> | null {
  const rec = read().find((u) => u.id === id)
  if (!rec) return null
  const { hash, ...meta } = rec
  return meta
}

/** Create a viewer account. Throws with a user-facing message if invalid. */
export function createUser(username: string, password: string): Omit<UserRecord, 'hash'> {
  const usernameErr = validateUsername(username)
  if (usernameErr) throw new Error(usernameErr)
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  const norm = normalizeUsername(username)
  if (read().some((u) => u.username === norm)) {
    throw new Error('a viewer with that username already exists')
  }
  const record = mintUser(username, hashPassword(password), Date.now())
  persist([...read(), record])
  const { hash, ...meta } = record
  return meta
}

/** End every session of an account, on all devices. Returns false if no such account. */
export function signOutUser(id: string, now = Date.now()): boolean {
  const all = read()
  const rec = all.find((u) => u.id === id)
  if (!rec) return false
  rec.signedOutAt = now
  persist(all)
  return true
}

/** Delete by id. Returns false if no such account. */
export function deleteUser(id: string): boolean {
  const before = read()
  const after = before.filter((u) => u.id !== id)
  if (after.length === before.length) return false
  persist(after)
  return true
}

/**
 * The viewer account of an SSO identity, created on its first sign-in. Matched by
 * issuer and subject only, never by email or name: those can be changed or reused
 * at the provider, and linking on them would let one person take over another's
 * account. The account has no password, so it can only come in through SSO.
 */
export function findOrCreateSsoUser(iss: string, sub: string, claims: Record<string, unknown>, role: 'admin' | 'viewer'): Omit<UserRecord, 'hash'> {
  const all = read()
  const found = all.find((u) => u.sso?.iss === iss && u.sso?.sub === sub)
  if (found) {
    found.lastLoginAt = Date.now()
    // the provider's groups decide, at every sign-in: promoted or demoted here
    found.role = role
    persist(all)
    const { hash, ...meta } = found
    return meta
  }
  const username = uniqueUsername(usernameFromClaims(claims), (u) => all.some((x) => x.username === u))
  const record: UserRecord = { ...mintUser(username, '', Date.now()), sso: { iss, sub }, role, lastLoginAt: Date.now() }
  persist([...all, record])
  const { hash, ...meta } = record
  return meta
}

/** Verify a viewer login → account metadata, or null. Stamps lastLoginAt. */
export function verifyUserLogin(username: string, password: string): Omit<UserRecord, 'hash'> | null {
  const norm = normalizeUsername(username)
  const rec = read().find((u) => u.username === norm)
  const ok = verifyHash(password, rec?.hash || DECOY_HASH)
  if (!rec || !rec.hash || !ok) return null
  rec.lastLoginAt = Date.now()
  persist(read())
  const { hash, ...meta } = rec
  return meta
}
