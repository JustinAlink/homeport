import { createSessionToken, SESSION_COOKIE } from '../utils/session'
import { authMode, setPassword, skipAuth } from '../utils/auth'

// Public, but only effective during first-run setup (no password configured yet).
// Either sets the admin password, or records "skip" to run without a login.
export default defineEventHandler(async (event) => {
  if (authMode() !== 'setup') {
    throw createError({ statusCode: 403, statusMessage: 'Setup is already complete.' })
  }

  const body = await readBody<{ password?: string; skip?: boolean }>(event)

  if (body?.skip) {
    skipAuth()
    return { ok: true, open: true }
  }

  try {
    setPassword(body?.password ?? '')
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not set password' })
  }

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
