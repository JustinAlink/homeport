import { trustedAuthHeader } from '../../utils/auth'
import { forwardAuthUser } from '../../utils/auth-core'
import { SESSION_COOKIE, decodeSessionToken } from '../../utils/session'
import { getUser } from '../../utils/users'

// Reached only if the auth middleware let the request through (valid session,
// open mode, or a trusted forward-auth header). Surface the proxy user, or the
// viewer's identity, if any — a small amount of duplicated decoding vs. the
// middleware is fine here, it's just for display.
export default defineEventHandler((event) => {
  const th = trustedAuthHeader()
  if (th) {
    const user = forwardAuthUser(th, (n) => getHeader(event, n))
    return { ok: true, user: user || null, forwardAuth: true, role: 'admin' }
  }

  const session = decodeSessionToken(getCookie(event, SESSION_COOKIE))
  if (session?.uid) {
    const viewer = getUser(session.uid)
    return { ok: true, user: viewer?.username || null, forwardAuth: false, role: 'viewer' }
  }

  return { ok: true, user: null, forwardAuth: false, role: 'admin' }
})
