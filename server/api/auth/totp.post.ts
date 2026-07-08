import { createSessionToken, verifyPendingTotpToken, SESSION_COOKIE } from '../../utils/session'
import { verifyLoginCode, verifyAndConsumeRecoveryCode } from '../../utils/totp'
import {
  lockRemaining,
  recordFailure,
  globalLockRemaining,
  recordGlobalFailure,
  type LoginRate,
} from '../../utils/auth-core'

// Second step of login when 2FA is enrolled: the client holds the pending
// token /api/auth/login handed back after the password checked out, and
// submits either a 6-digit TOTP code or a one-time recovery code here.
// Rate-limited independently (and harder) than the password step — a 6-digit
// space is far more guessable than a password.
const attempts = new Map<string, LoginRate>()
const MAP_CAP = 10_000
let globalRate: LoginRate | undefined

const trustProxy = process.env.HOMEPORT_TRUSTED_PROXY === 'true' || process.env.HOMEPORT_TRUSTED_PROXY === '1'

export default defineEventHandler(async (event) => {
  const ip = (trustProxy ? getRequestIP(event, { xForwardedFor: true }) : getRequestIP(event)) || 'unknown'
  const now = Date.now()

  const gWait = globalLockRemaining(globalRate, now)
  if (gWait > 0) {
    throw createError({ statusCode: 429, statusMessage: `Too many failed attempts across all clients — try again in ${Math.ceil(gWait / 1000)}s.` })
  }
  const wait = lockRemaining(attempts.get(ip), now)
  if (wait > 0) {
    throw createError({ statusCode: 429, statusMessage: `Too many failed attempts — try again in ${Math.ceil(wait / 1000)}s.` })
  }

  const body = await readBody<{ pending?: string; code?: string; recovery?: string }>(event)
  const pending = typeof body?.pending === 'string' ? body.pending : undefined
  if (!verifyPendingTotpToken(pending)) {
    throw createError({ statusCode: 401, statusMessage: 'Login step expired — sign in again.' })
  }

  const recovery = typeof body?.recovery === 'string' ? body.recovery : ''
  const code = typeof body?.code === 'string' ? body.code : ''
  const ok = recovery ? verifyAndConsumeRecoveryCode(recovery) : verifyLoginCode(code, now)
  if (!ok) {
    if (attempts.size >= MAP_CAP) attempts.clear()
    attempts.set(ip, recordFailure(attempts.get(ip), now))
    globalRate = recordGlobalFailure(globalRate, now)
    await new Promise((r) => setTimeout(r, 300))
    throw createError({ statusCode: 401, statusMessage: recovery ? 'Incorrect recovery code' : 'Incorrect code' })
  }
  attempts.delete(ip)

  const proto = getHeader(event, 'x-forwarded-proto') || 'http'
  setCookie(event, SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return { ok: true }
})
