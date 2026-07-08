import { SESSION_COOKIE } from '../../utils/session'
import { bumpGeneration } from '../../utils/auth'
import { getConfig } from '../../utils/config'

export default defineEventHandler((event) => {
  // Revoke every outstanding token, not just this browser's cookie — so a
  // logout actually kills a session even if a copy of the cookie leaked.
  // (Signs out all devices; that's the intended trade for real revocation.)
  if (!getConfig().demo) bumpGeneration()
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  return { ok: true }
})
