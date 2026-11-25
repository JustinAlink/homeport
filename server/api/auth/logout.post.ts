import { SESSION_COOKIE, decodeSessionToken } from '../../utils/session'
import { bumpGeneration } from '../../utils/auth'
import { getConfig } from '../../utils/config'

export default defineEventHandler((event) => {
  // An admin logout revokes every outstanding token, not just this browser's
  // cookie, so a logout actually kills a session even if a copy of the cookie
  // leaked (signs out all devices; that's the intended trade for real revocation).
  // This path is public (the middleware lets it through), so the bump needs a
  // valid admin session: anyone could otherwise sign everybody out in a loop, and
  // a viewer logging out would sign the admin out. A viewer's own sessions end when
  // the account is deleted, which is checked on every request.
  const session = decodeSessionToken(getCookie(event, SESSION_COOKIE))
  if (session && !session.uid && !getConfig().demo) bumpGeneration()
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  return { ok: true }
})
