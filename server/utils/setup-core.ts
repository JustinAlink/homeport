import { randomInt } from 'node:crypto'
import { constantEquals } from './auth-core.ts'

// First-run setup gate (pure, unit-testable). Until an admin password exists,
// POST /api/setup is the one unauthenticated route that can create it, so a
// fresh install must not belong to whoever reaches it first. It takes a one-time
// code that homeport prints only to its own log: reading `docker logs` already
// needs Docker access on the host, which is the trust homeport itself runs
// with, so whoever can finish setup could have configured it anyway.

// Crockford base32 (no I, L, O, U), so a code read off a terminal and typed on
// a phone has no 1/I/l or 0/O mix-ups. 12 characters = 60 bits: far past online
// guessing, before the rate limit even starts.
export const SETUP_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const SETUP_CODE_LENGTH = 12

/** A fresh code, shown as XXXX-XXXX-XXXX. */
export function generateSetupCode(): string {
  let raw = ''
  for (let i = 0; i < SETUP_CODE_LENGTH; i++) raw += SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)]
  return raw.match(/.{4}/g)!.join('-')
}

/**
 * Canonical form for comparing: case, spaces and dashes don't matter, and the
 * look-alikes O, I and L read as 0 and 1 (Crockford's decoding rule). Anything
 * that isn't a short string normalizes to '' (never a match).
 */
export function normalizeSetupCode(input: unknown): string {
  if (typeof input !== 'string' || input.length > 64) return ''
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

/** Constant-time check of a typed code against the current one. */
export function setupCodeMatches(input: unknown, expected: string): boolean {
  const want = normalizeSetupCode(expected)
  const got = normalizeSetupCode(input)
  return want.length === SETUP_CODE_LENGTH && got.length > 0 && constantEquals(got, want)
}

export const SKIP_REFUSED =
  'Running without a login is no longer a setup option. Set HOMEPORT_ALLOW_OPEN=true in homeport\'s environment (trusted private networks only), or create a password.'
export const CODE_MISSING = 'Enter the setup code from homeport\'s log.'
export const CODE_WRONG =
  'That setup code doesn\'t match. Use the newest one in homeport\'s log: a new code is made every time homeport restarts.'

export type SetupVerdict =
  | { ok: true }
  | { ok: false; status: number; message: string; failedGuess: boolean; field?: 'code' }

/**
 * May this POST /api/setup create the admin password? The whole gate in one
 * place, so the invariants are testable: only a matching code gets through,
 * and "skip" never does. Turning the login off is HOMEPORT_ALLOW_OPEN's job,
 * set where the deploy is configured and reviewed, not a click any visitor
 * could make and that then sits unseen in the data dir.
 *
 * `failedGuess` marks attempts that should count toward the rate limit;
 * `field` tells the form which input the message is about.
 */
export function judgeSetup(
  mode: string,
  body: { code?: unknown; skip?: unknown; password?: unknown } | null | undefined,
  expected: string,
): SetupVerdict {
  if (mode !== 'setup') return { ok: false, status: 403, message: 'Setup is already complete.', failedGuess: false }
  if (body?.skip) return { ok: false, status: 403, message: SKIP_REFUSED, failedGuess: false }
  if (!normalizeSetupCode(body?.code)) return { ok: false, status: 400, message: CODE_MISSING, failedGuess: false, field: 'code' }
  if (!setupCodeMatches(body?.code, expected)) return { ok: false, status: 403, message: CODE_WRONG, failedGuess: true, field: 'code' }
  return { ok: true }
}
