import { createSessionToken, SESSION_COOKIE } from '../../utils/session'
import { hasPassword, verifyPassword } from '../../utils/auth'
import { lockRemaining, recordFailure, type LoginRate } from '../../utils/auth-core'

// Failed-login tracking per client IP (in-memory; resets on restart, which is
// fine — its job is slowing brute force, not being a ledger).
const attempts = new Map<string, LoginRate>()
const MAP_CAP = 10_000

export default defineEventHandler(async (event) => {
  if (!hasPassword()) {
    throw createError({ statusCode: 409, statusMessage: 'No password set yet — complete first-run setup.' })
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const now = Date.now()
  const wait = lockRemaining(attempts.get(ip), now)
  if (wait > 0) {
    throw createError({
      statusCode: 429,
      statusMessage: `Too many failed attempts — try again in ${Math.ceil(wait / 1000)}s.`,
    })
  }

  const body = await readBody<{ password?: string }>(event)
  if (!verifyPassword(body?.password ?? '')) {
    if (attempts.size >= MAP_CAP) attempts.clear() // crude but bounded
    attempts.set(ip, recordFailure(attempts.get(ip), now))
    await new Promise((r) => setTimeout(r, 300)) // flat cost per wrong guess
    throw createError({ statusCode: 401, statusMessage: 'Incorrect password' })
  }
  attempts.delete(ip)

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
