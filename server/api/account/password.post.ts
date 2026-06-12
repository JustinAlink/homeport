import { verifyPassword, setPassword } from '../../utils/auth'
import { getConfig } from '../../utils/config'

// Change the admin password (authenticated). Requires the current password.
// No-op when the password is locked by HOMEPORT_ADMIN_PASSWORD (env wins).
export default defineEventHandler(async (event) => {
  if (getConfig().demo) return { ok: true } // demo: don't mutate auth

  const body = await readBody<{ current?: string; password?: string }>(event)
  if (!verifyPassword(body?.current ?? '')) {
    throw createError({ statusCode: 401, statusMessage: 'Current password is incorrect.' })
  }
  try {
    setPassword(body?.password ?? '')
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not change password' })
  }
  return { ok: true }
})
