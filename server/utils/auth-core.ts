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
