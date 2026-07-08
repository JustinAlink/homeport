import { verifyPassword, setPassword } from '../../utils/auth'
import { createSessionToken, SESSION_COOKIE } from '../../utils/session'
import { getConfig } from '../../utils/config'
import { reauthWaitMs, recordReauthFailure, recordReauthSuccess } from '../../utils/reauth-rate'

const trustProxy = process.env.HOMEPORT_TRUSTED_PROXY === 'true' || process.env.HOMEPORT_TRUSTED_PROXY === '1'

// Change the admin password (authenticated). Requires the current password.
// No-op when the password is locked by HOMEPORT_ADMIN_PASSWORD (env wins).
export default defineEventHandler(async (event) => {
  if (getConfig().demo) return { ok: true } // demo: don't mutate auth

  const ip = (trustProxy ? getRequestIP(event, { xForwardedFor: true }) : getRequestIP(event)) || 'unknown'
  const now = Date.now()
  const wait = reauthWaitMs(ip, now)
  if (wait > 0) {
    throw createError({ statusCode: 429, statusMessage: `Too many failed attempts — try again in ${Math.ceil(wait / 1000)}s.` })
  }

  const body = await readBody<{ current?: string; password?: string }>(event)
  if (!verifyPassword(body?.current ?? '')) {
    recordReauthFailure(ip, now)
    await new Promise((r) => setTimeout(r, 300))
    throw createError({ statusCode: 401, statusMessage: 'Current password is incorrect.' })
  }
  recordReauthSuccess(ip)
  try {
    setPassword(body?.password ?? '')
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not change password' })
  }
  // setPassword() bumped the session generation, invalidating every existing
  // cookie (including this one). Re-issue a fresh cookie so the admin who just
  // changed their password stays logged in on this device.
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
