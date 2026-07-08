import { SESSION_COOKIE, verifySessionToken } from '../utils/session'
import { authMode, trustedAuthHeader } from '../utils/auth'
import { forwardAuthUser } from '../utils/auth-core'
import { verifyApiToken } from '../utils/api-tokens'
import { scopeAllows } from '../utils/api-tokens-core'

// Gate the API (pages redirect client-side). Fail-closed: a valid session is
// required unless auth is intentionally off (open mode). /api/auth/* and the
// first-run /api/setup are always reachable.
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  if (path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/setup') return

  // open mode (no password, user skipped it or the volume is read-only) → no auth
  if (authMode() === 'open') return

  // Forward-auth: a trusted upstream proxy already authenticated the user and
  // passes their name in a header we trust (homeport must sit behind that proxy).
  const th = trustedAuthHeader()
  if (th && forwardAuthUser(th, (n) => getHeader(event, n))) return

  // Scoped API token (Authorization: Bearer hp_…) — automation without the password.
  const authz = getHeader(event, 'authorization') || ''
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (bearer) {
    const t = verifyApiToken(bearer)
    if (!t) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    // Tokens can't manage tokens — a leaked token must not mint or revoke others.
    if (path === '/api/tokens' || path.startsWith('/api/tokens/'))
      throw createError({ statusCode: 403, statusMessage: 'API tokens cannot manage tokens' })
    if (!scopeAllows(t.scope, event.method, path))
      throw createError({ statusCode: 403, statusMessage: 'this token is read-only' })
    return
  }

  if (!verifySessionToken(getCookie(event, SESSION_COOKIE))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
