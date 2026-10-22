import { createSessionToken, createPendingTotpToken, SESSION_COOKIE } from '../../utils/session'
import { hasPassword, verifyPassword } from '../../utils/auth'
import { isTotpEnabled } from '../../utils/totp'
import { verifyUserLogin } from '../../utils/users'
import { isAdminLoginName } from '../../utils/users-core'
import {
  lockRemaining,
  recordFailure,
  globalLockRemaining,
  recordGlobalFailure,
  type LoginRate,
} from '../../utils/auth-core'

// Failed-login tracking per client IP (in-memory; resets on restart, which is
// fine — its job is slowing brute force, not being a ledger). Kept separate
// per credential type so a legitimate user's own viewer-login typos can't
// self-inflict an admin lockout from the same IP (and vice versa); the
// rotation-proof global ceiling below stays shared on purpose.
const adminAttempts = new Map<string, LoginRate>()
const viewerAttempts = new Map<string, LoginRate>()
const MAP_CAP = 10_000
// A single global counter that no key rotation can dodge (see auth-core).
let globalRate: LoginRate | undefined

// X-Forwarded-For is only trustworthy when a proxy WE control sets it — a
// directly-exposed instance lets any client forge it, defeating per-IP limits.
// Trust it only on explicit opt-in; otherwise key on the real socket address.
const trustProxy = process.env.HOMEPORT_TRUSTED_PROXY === 'true' || process.env.HOMEPORT_TRUSTED_PROXY === '1'

export default defineEventHandler(async (event) => {
  if (!hasPassword()) {
    throw createError({ statusCode: 409, statusMessage: 'No password set yet — complete first-run setup.' })
  }

  const ip = (trustProxy ? getRequestIP(event, { xForwardedFor: true }) : getRequestIP(event)) || 'unknown'
  const now = Date.now()

  // Global ceiling first — rotation-proof, so it can't be sidestepped by a fresh key.
  const gWait = globalLockRemaining(globalRate, now)
  if (gWait > 0) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many failed attempts across all clients — try again in ${Math.ceil(gWait / 1000)}s.`,
    })
  }

  const body = await readBody<{ username?: string; password?: string }>(event)
  // "admin" or an empty field = the primary account (see isAdminLoginName)
  const rawName = typeof body?.username === 'string' ? body.username.trim() : ''
  const username = isAdminLoginName(rawName) ? '' : rawName
  const attempts = username ? viewerAttempts : adminAttempts

  const wait = lockRemaining(attempts.get(ip), now)
  if (wait > 0) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many failed attempts — try again in ${Math.ceil(wait / 1000)}s.`,
    })
  }

  // A viewer account login — same rate limiting, no 2FA (v1 scope cut).
  if (username) {
    const viewer = verifyUserLogin(username, body?.password ?? '')
    if (!viewer) {
      if (attempts.size >= MAP_CAP) attempts.clear() // crude but bounded
      attempts.set(ip, recordFailure(attempts.get(ip), now))
      globalRate = recordGlobalFailure(globalRate, now)
      await new Promise((r) => setTimeout(r, 300)) // flat cost per wrong guess
      throw createError({ statusCode: 401, statusMessage: 'Incorrect username or password' })
    }
    attempts.delete(ip)

    const proto = getHeader(event, 'x-forwarded-proto') || 'http'
    setCookie(event, SESSION_COOKIE, createSessionToken(viewer.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: proto === 'https', // adapts whether accessed via https (NPM) or plain http
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
    return { ok: true }
  }

  if (!verifyPassword(body?.password ?? '')) {
    if (attempts.size >= MAP_CAP) attempts.clear() // crude but bounded
    attempts.set(ip, recordFailure(attempts.get(ip), now))
    globalRate = recordGlobalFailure(globalRate, now)
    await new Promise((r) => setTimeout(r, 300)) // flat cost per wrong guess
    throw createError({ statusCode: 401, statusMessage: 'Incorrect password' })
  }
  attempts.delete(ip)

  // Password's right. If 2FA is enrolled, don't grant a session yet — hand back
  // a short-lived pending token and make the client complete /api/auth/totp.
  if (isTotpEnabled()) {
    return { ok: true, needsTotp: true, pending: createPendingTotpToken() }
  }

  const proto = getHeader(event, 'x-forwarded-proto') || 'http'
  setCookie(event, SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https', // adapts whether accessed via https (NPM) or plain http
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return { ok: true }
})
