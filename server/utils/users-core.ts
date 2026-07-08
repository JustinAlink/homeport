import { randomBytes } from 'node:crypto'

// Secondary "viewer" accounts — read-only logins alongside the single admin
// (which stays the implicit, username-less identity). Pure (only node:crypto),
// so it's unit-testable in isolation; the fs layer lives in users.ts. Password
// hashing itself is NOT duplicated here — reuse hashPassword/verifyHash from
// auth-core.ts, which are already generic (not admin-specific).

export interface UserRecord {
  id: string
  username: string
  hash: string
  createdAt: number
  lastLoginAt?: number
}

export const MIN_USERNAME_LENGTH = 3

/** Normalize a username for storage/comparison: trim + lowercase. */
export function normalizeUsername(u: string): string {
  return u.trim().toLowerCase()
}

/** Username rules, or null if valid. "admin" is reserved for the primary account. */
export function validateUsername(u: string): string | null {
  const n = normalizeUsername(u)
  if (n.length < MIN_USERNAME_LENGTH || n.length > 32) {
    return `username must be ${MIN_USERNAME_LENGTH}-32 characters`
  }
  if (!/^[a-z0-9_.-]+$/.test(n)) {
    return 'username may only contain lowercase letters, numbers, "_", "." and "-"'
  }
  if (n === 'admin') {
    return '"admin" is reserved for the primary account'
  }
  return null
}

/** Mint a viewer account record from an already-validated username + hash. */
export function mintUser(username: string, hash: string, now: number): UserRecord {
  return {
    id: randomBytes(6).toString('hex'),
    username: normalizeUsername(username),
    hash,
    createdAt: now,
  }
}
