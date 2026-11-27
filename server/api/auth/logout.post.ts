import { SESSION_COOKIE, decodeSessionToken } from '../../utils/session'
import { bumpGeneration } from '../../utils/auth'
import { getConfig } from '../../utils/config'
import { signOutUser } from '../../utils/users'
import { accessOfSession } from '../../utils/session-access'

export default defineEventHandler((event) => {
  // An admin logout revokes every outstanding token, not just this browser's
  // cookie, so a logout actually kills a session even if a copy of the cookie
  // leaked (signs out all devices; that's the intended trade for real revocation).
  // This path is public (the middleware lets it through), so the bump needs a
  // valid admin session: anyone could otherwise sign everybody out in a loop, and
  // a viewer logging out would sign the admin out.
  // An account (viewer or SSO) signs out the same way, but only itself: its own
  // sessions on every device end, nobody else's.
  const session = decodeSessionToken(getCookie(event, SESSION_COOKIE))
  // The demo's shared admin is the exception: one visitor must not sign out the rest.
  // Only a live session may: a copy of an already revoked cookie must not keep
  // signing its owner out.
  if (session?.uid) {
    if (accessOfSession(session)) signOutUser(session.uid)
  } else if (session && !getConfig().demo) bumpGeneration()
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  return { ok: true }
})
