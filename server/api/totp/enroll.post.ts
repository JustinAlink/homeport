import QRCode from 'qrcode'
import { beginEnroll, isTotpEnabled } from '../../utils/totp'

// Start 2FA enrollment: a fresh secret + QR, nothing persisted until the
// matching code is confirmed via /api/totp/confirm.
export default defineEventHandler(async () => {
  // Replacing an active secret must go through disable, which re-checks the
  // password; see confirm.post.ts for why.
  if (isTotpEnabled()) throw createError({ statusCode: 409, statusMessage: '2FA is already on. Turn it off first to set it up again.' })
  const { secret, otpauthUri } = beginEnroll()
  const qrSvg = await QRCode.toString(otpauthUri, { type: 'svg', margin: 1 })
  return { secret, otpauthUri, qrSvg }
})
