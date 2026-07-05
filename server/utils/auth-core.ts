import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

// Pure password hashing (scrypt). Stored form: "<saltHex>:<hashHex>". Only node:crypto
// is imported (a builtin), so this is unit-testable in isolation.

export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyHash(plain: string, stored: string | undefined): boolean {
  if (!stored) return false
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  try {
    const expected = Buffer.from(hashHex, 'hex')
    const actual = scryptSync(plain, Buffer.from(saltHex, 'hex'), expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** Constant-time compare for the env-password path. */
export function constantEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const MIN_PASSWORD_LENGTH = 6

// --- login rate limiting (pure state machine; the endpoint owns the Map) ---
//
// A few attempts are free; from FREE_FAILS onward each failure locks the key
// out, doubling from LOCK_BASE_MS up to LOCK_MAX_MS. A success — or QUIET_MS
// without attempts — clears the slate.

export const FREE_FAILS = 5
export const LOCK_BASE_MS = 30_000
export const LOCK_MAX_MS = 15 * 60_000
export const QUIET_MS = 60 * 60_000

export interface LoginRate {
  fails: number
  lastAt: number
  lockedUntil: number
}

/** ms until this key may try again (0 = allowed). Expired/quiet state counts as fresh. */
export function lockRemaining(state: LoginRate | undefined, now: number): number {
  if (!state || now - state.lastAt > QUIET_MS) return 0
  return Math.max(0, state.lockedUntil - now)
}

/** Record a failed attempt and return the new state. */
export function recordFailure(state: LoginRate | undefined, now: number): LoginRate {
  const fresh = !state || now - state.lastAt > QUIET_MS
  const fails = (fresh ? 0 : state!.fails) + 1
  const over = fails - FREE_FAILS
  const lockedUntil = over >= 0 ? now + Math.min(LOCK_BASE_MS * 2 ** over, LOCK_MAX_MS) : 0
  return { fails, lastAt: now, lockedUntil }
}
