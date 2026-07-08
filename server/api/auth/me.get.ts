import { trustedAuthHeader } from '../../utils/auth'
import { forwardAuthUser } from '../../utils/auth-core'

// Reached only if the auth middleware let the request through (valid session,
// open mode, or a trusted forward-auth header). Surface the proxy user if any.
export default defineEventHandler((event) => {
  const th = trustedAuthHeader()
  const user = th ? forwardAuthUser(th, (n) => getHeader(event, n)) : ''
  return { ok: true, user: user || null, forwardAuth: !!th }
})
