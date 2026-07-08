import { isTotpEnabled, recoveryCodesRemaining } from '../utils/totp'

// Status for the settings page. Authenticated (default middleware gate).
export default defineEventHandler(() => {
  const enabled = isTotpEnabled()
  return { enabled, recoveryRemaining: enabled ? recoveryCodesRemaining() : undefined }
})
