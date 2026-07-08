import { verifyPassword } from '../../utils/auth'
import { disableTotp } from '../../utils/totp'
import { reauthWaitMs, recordReauthFailure, recordReauthSuccess } from '../../utils/reauth-rate'

const trustProxy = process.env.HOMEPORT_TRUSTED_PROXY === 'true' || process.env.HOMEPORT_TRUSTED_PROXY === '1'

// Turn 2FA off. Requires re-entering the current password (same bar as
// changing it) so a hijacked-but-unlocked browser tab can't silently drop it.
export default defineEventHandler(async (event) => {
  const ip = (trustProxy ? getRequestIP(event, { xForwardedFor: true }) : getRequestIP(event)) || 'unknown'
  const now = Date.now()
  const wait = reauthWaitMs(ip, now)
  if (wait > 0) {
    throw createError({ statusCode: 429, statusMessage: `Too many failed attempts — try again in ${Math.ceil(wait / 1000)}s.` })
  }

  const body = await readBody<{ password?: string }>(event)
  if (!verifyPassword(body?.password ?? '')) {
    recordReauthFailure(ip, now)
    await new Promise((r) => setTimeout(r, 300))
    throw createError({ statusCode: 401, statusMessage: 'Current password is incorrect.' })
  }
  recordReauthSuccess(ip)
  disableTotp()
  return { ok: true }
})
