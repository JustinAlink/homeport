import QRCode from 'qrcode'
import { beginEnroll } from '../../utils/totp'

// Start 2FA enrollment: a fresh secret + QR, nothing persisted until the
// matching code is confirmed via /api/totp/confirm.
export default defineEventHandler(async () => {
  const { secret, otpauthUri } = beginEnroll()
  const qrSvg = await QRCode.toString(otpauthUri, { type: 'svg', margin: 1 })
  return { secret, otpauthUri, qrSvg }
})
