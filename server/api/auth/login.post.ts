import { createSessionToken, SESSION_COOKIE } from '../../utils/session'
import { hasPassword, verifyPassword } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  if (!hasPassword()) {
    throw createError({ statusCode: 409, statusMessage: 'No password set yet — complete first-run setup.' })
  }

  const body = await readBody<{ password?: string }>(event)
  if (!verifyPassword(body?.password ?? '')) {
    throw createError({ statusCode: 401, statusMessage: 'Incorrect password' })
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
