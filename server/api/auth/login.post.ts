import { timingSafeEqual } from 'node:crypto'
import { getConfig } from '../../utils/config'
import { createSessionToken, SESSION_COOKIE } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { adminPassword } = getConfig()
  if (!adminPassword) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Login is unavailable: set HOMEPORT_ADMIN_PASSWORD on the server.',
    })
  }

  const body = await readBody<{ password?: string }>(event)
  const supplied = Buffer.from(body?.password ?? '')
  const expected = Buffer.from(adminPassword)
  const ok = supplied.length === expected.length && timingSafeEqual(supplied, expected)
  if (!ok) {
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
