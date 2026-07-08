import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { verifyTotp, mintRecoveryCodes, matchRecoveryCode, randomSecret, otpauthUri } from './totp-core'

// Persistence for TOTP 2FA on the single local admin account (<data>/totp.json,
// 0600). The secret is only written once enrollment is *confirmed* (a valid
// code was entered) — an abandoned enroll attempt never touches disk.

interface TotpFile {
  secret?: string
  enabled?: boolean
  recoveryHashes?: string[]
  lastCounter?: number
}

const file = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'totp.json')

let cache: TotpFile | null = null

function read(): TotpFile {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache!
}

function write(patch: TotpFile): TotpFile {
  const next = { ...read(), ...patch }
  const dir = process.env.HOMEPORT_DATA_DIR || '/data'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 })
  cache = next
  return next
}

export function isTotpEnabled(): boolean {
  return !!read().enabled
}

export function recoveryCodesRemaining(): number {
  return read().recoveryHashes?.length || 0
}

/** Start enrollment: a fresh secret + provisioning URI. Nothing persisted yet. */
export function beginEnroll(accountLabel = 'admin'): { secret: string; otpauthUri: string } {
  const secret = randomSecret()
  return { secret, otpauthUri: otpauthUri(secret, accountLabel) }
}

/**
 * Confirm enrollment: the secret the client was just given, plus a code proving
 * they scanned it correctly. On success, persists the secret + fresh recovery
 * codes and returns the plaintext codes (shown once).
 */
export function confirmEnroll(secret: string, code: string, now: number): { codes: string[] } | null {
  const result = verifyTotp(secret, code, now)
  if (!result.valid) return null
  const { codes, hashes } = mintRecoveryCodes()
  write({ secret, enabled: true, recoveryHashes: hashes, lastCounter: result.counter })
  return { codes }
}

/** Disable 2FA entirely (caller must have already re-verified the password). */
export function disableTotp(): void {
  write({ secret: undefined, enabled: false, recoveryHashes: undefined, lastCounter: undefined })
}

/** New recovery codes, invalidating the old set (caller re-verifies the password). */
export function regenerateRecoveryCodes(): { codes: string[] } {
  const { codes, hashes } = mintRecoveryCodes()
  write({ recoveryHashes: hashes })
  return { codes }
}

/** Verify a 6-digit code at login. Persists the matched counter (replay guard). */
export function verifyLoginCode(code: string, now: number): boolean {
  const state = read()
  if (!state.enabled || !state.secret) return false
  const result = verifyTotp(state.secret, code, now, state.lastCounter)
  if (!result.valid) return false
  write({ lastCounter: result.counter })
  return true
}

/** Verify + consume a recovery code at login (single-use). */
export function verifyAndConsumeRecoveryCode(code: string): boolean {
  const state = read()
  if (!state.enabled || !state.recoveryHashes?.length) return false
  const idx = matchRecoveryCode(code, state.recoveryHashes)
  if (idx < 0) return false
  const remaining = state.recoveryHashes.filter((_, i) => i !== idx)
  write({ recoveryHashes: remaining })
  return true
}
