import { randomBytes } from 'node:crypto'

// Secondary "viewer" accounts — read-only logins alongside the single admin
// (which stays the implicit, username-less identity). Pure (only node:crypto),
// so it's unit-testable in isolation; the fs layer lives in users.ts. Password
// hashing itself is NOT duplicated here — reuse hashPassword/verifyHash from
// auth-core.ts, which are already generic (not admin-specific).

export interface UserRecord {
  id: string
  username: string
  /** empty for accounts that sign in through SSO only: no password can ever match */
  hash: string
  createdAt: number
  lastLoginAt?: number
  /** created by a single sign-on login: the provider's issuer and subject */
  sso?: { iss: string; sub: string }
  /** 'admin' only for an SSO account in an admin group (set at each sign-in); absent = read-only */
  role?: 'admin' | 'viewer'
  /** sessions issued before this are void ("sign out everywhere" for this account) */
  signedOutAt?: number
}

export type AccessRole = 'admin' | 'viewer'

/**
 * What a valid session token may do, given its account. No account id is the
 * primary admin. An account id is checked fresh on every request, so deleting the
 * account, signing it out, or turning single sign-on off (for an SSO account) ends
 * its sessions at once, on every device; the role comes from the account, never
 * from the token.
 */
export function sessionAccess(
  session: { iat: number; uid?: string } | null,
  user: Pick<UserRecord, 'role' | 'signedOutAt' | 'sso'> | null,
  ssoUsable: boolean,
): AccessRole | null {
  if (!session) return null
  if (!session.uid) return 'admin'
  if (!user) return null
  if (user.signedOutAt && session.iat < user.signedOutAt) return null
  if (user.sso && !ssoUsable) return null
  return user.role === 'admin' ? 'admin' : 'viewer'
}

export const MIN_USERNAME_LENGTH = 3

/** Normalize a username for storage/comparison: trim + lowercase. */
export function normalizeUsername(u: string): string {
  return u.trim().toLowerCase()
}

/**
 * The primary account has no stored username; "admin" (reserved below, so no
 * viewer can own it) and an empty field both mean "sign in as the admin".
 */
export function isAdminLoginName(u: string | undefined | null): boolean {
  const n = normalizeUsername(u ?? '')
  return n === '' || n === 'admin'
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

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The accounts from a backup file, keeping only well-formed ones. The file is the
 * admin's own but still input, and an account is a way in, so: ids and usernames
 * in the shapes homeport makes (never "admin"), password hashes in hashPassword's
 * shape, and the admin role only on an SSO account (a password account can't be
 * one anywhere else either). An account with neither a password nor SSO could
 * never sign in and is left out. Duplicates keep the first.
 */
export function sanitizeUsersBackup(data: unknown): UserRecord[] {
  if (!Array.isArray(data)) return []
  const out: UserRecord[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const raw of data.slice(0, 1000)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' && /^[0-9a-f]{12}$/.test(r.id) ? r.id : null
    const username = typeof r.username === 'string' && !validateUsername(r.username) ? normalizeUsername(r.username) : null
    if (!id || !username || ids.has(id) || names.has(username)) continue
    const hash = typeof r.hash === 'string' && /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(r.hash) ? r.hash : ''
    const s = r.sso as Record<string, unknown> | undefined
    const sso = s && typeof s.iss === 'string' && typeof s.sub === 'string' && s.iss && s.sub && s.iss.length <= 500 && s.sub.length <= 255 ? { iss: s.iss, sub: s.sub } : undefined
    if (!hash && !sso) continue
    const rec: UserRecord = { id, username, hash, createdAt: finite(r.createdAt) ? r.createdAt : Date.now() }
    if (sso) rec.sso = sso
    if (sso && (r.role === 'admin' || r.role === 'viewer')) rec.role = r.role
    if (finite(r.lastLoginAt)) rec.lastLoginAt = r.lastLoginAt
    if (finite(r.signedOutAt)) rec.signedOutAt = r.signedOutAt
    ids.add(id)
    names.add(username)
    out.push(rec)
  }
  return out
}
