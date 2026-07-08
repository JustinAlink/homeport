import { createHmac, randomBytes } from 'node:crypto'
import { hashPassword, verifyHash } from './auth-core.ts'

// TOTP (RFC 6238, built on the RFC 4226 HOTP algorithm) for the local admin
// account. Pure (only node:crypto + auth-core's generic hasher for recovery
// codes) — no fs, so it's unit-testable in isolation. The fs layer is totp.ts.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' // RFC 4648 base32, no padding
const STEP_SEC = 30
const DIGITS = 6
const WINDOW = 1 // ± this many 30s steps tolerated for clock drift

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** A fresh random TOTP secret, base32-encoded (160 bits). */
export function randomSecret(): string {
  return base32Encode(randomBytes(20))
}

/** RFC 4226 HOTP for a given counter. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  counterBuf.writeUInt32BE(counter >>> 0, 4)
  const hmac = createHmac('sha1', secret).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  const code = (bin % 10 ** digits).toString().padStart(digits, '0')
  return code
}

/** The current 30s time-step counter for a given instant. */
export function totpCounter(timeMs: number, stepSec = STEP_SEC): number {
  return Math.floor(timeMs / 1000 / stepSec)
}

/**
 * Verify a submitted code against a base32 secret at a point in time, tolerating
 * clock drift (±WINDOW steps). `lastCounter` (if given) rejects a counter at or
 * before one already consumed, so a captured code can't be replayed. Returns the
 * matched counter on success — the caller persists it as the new `lastCounter`.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  timeMs: number,
  lastCounter?: number,
): { valid: boolean; counter?: number } {
  const clean = (code || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return { valid: false }
  const secret = base32Decode(secretBase32)
  if (!secret.length) return { valid: false }
  const center = totpCounter(timeMs)
  for (let i = -WINDOW; i <= WINDOW; i++) {
    const counter = center + i
    if (lastCounter !== undefined && counter <= lastCounter) continue
    if (hotp(secret, counter) === clean) return { valid: true, counter }
  }
  return { valid: false }
}

/** otpauth:// provisioning URI for authenticator apps (Google Authenticator, Aegis, …). */
export function otpauthUri(secretBase32: string, accountLabel: string, issuer = 'homeport'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}`
  // Built with encodeURIComponent (not URLSearchParams, which form-encodes
  // spaces as '+') so every part of the URI uses the same percent-encoding.
  const params = [
    ['secret', secretBase32],
    ['issuer', issuer],
    ['algorithm', 'SHA1'],
    ['digits', String(DIGITS)],
    ['period', String(STEP_SEC)],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  return `otpauth://totp/${label}?${params}`
}

/** Fresh single-use recovery codes: the plaintext (shown once) + hashes to persist. */
export function mintRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
  const codes: string[] = []
  const hashes: string[] = []
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(5).toString('hex') // 10 hex chars
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`
    codes.push(code)
    hashes.push(hashPassword(code))
  }
  return { codes, hashes }
}

/**
 * Index of the hash matching a presented recovery code, or -1. Each individual
 * comparison is constant-time (scrypt + timingSafeEqual in verifyHash), but the
 * search short-circuits on the first match — position-in-array leaks via
 * latency. Not a practical concern: codes are single-use and this only runs
 * behind the login endpoint's own rate limiter.
 */
export function matchRecoveryCode(code: string, hashes: string[]): number {
  const clean = (code || '').trim()
  if (!clean) return -1
  return hashes.findIndex((h) => verifyHash(clean, h))
}
