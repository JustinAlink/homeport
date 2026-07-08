import { verifyPassword } from '../../utils/auth'
import { isTotpEnabled, regenerateRecoveryCodes } from '../../utils/totp'
import { reauthWaitMs, recordReauthFailure, recordReauthSuccess } from '../../utils/reauth-rate'

const trustProxy = process.env.HOMEPORT_TRUSTED_PROXY === 'true' || process.env.HOMEPORT_TRUSTED_PROXY === '1'

// Replace the recovery-code set (old ones stop working). Requires the current
// password, same bar as disabling 2FA.
export default defineEventHandler(async (event) => {
  if (!isTotpEnabled()) {
    throw createError({ statusCode: 409, statusMessage: '2FA is not enabled.' })
  }

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
  const { codes } = regenerateRecoveryCodes()
  return { ok: true, recoveryCodes: codes }
})
