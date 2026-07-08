import { SESSION_COOKIE, decodeSessionToken } from '../utils/session'
import { authMode, trustedAuthHeader } from '../utils/auth'
import { forwardAuthUser } from '../utils/auth-core'
import { verifyApiToken } from '../utils/api-tokens'
import { getUser } from '../utils/users'
import { scopeAllows } from '../utils/api-tokens-core'

// Gate the API (pages redirect client-side). Fail-closed: a valid session is
// required unless auth is intentionally off (open mode). /api/auth/* and the
// first-run /api/setup are always reachable.
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  // /api/auth/totp is the second (2FA) step of login, gated by its own
  // short-lived pending token + rate limit rather than a session — a caller
  // here hasn't finished logging in yet, so no session cookie exists.
  if (path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/auth/totp' || path === '/api/setup') return

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
    // Nor manage 2FA — a leaked token must not read the enrollment secret,
    // disable 2FA, or mint fresh recovery codes.
    if (path === '/api/totp' || path.startsWith('/api/totp/'))
      throw createError({ statusCode: 403, statusMessage: 'API tokens cannot manage 2FA' })
    // Nor manage user accounts — a leaked token must not create/delete viewers.
    if (path === '/api/users' || path.startsWith('/api/users/'))
      throw createError({ statusCode: 403, statusMessage: 'API tokens cannot manage user accounts' })
    if (!scopeAllows(t.scope, event.method, path))
      throw createError({ statusCode: 403, statusMessage: 'this token is read-only' })
    return
  }

  // Session cookie. A viewer's role is resolved fresh on every request — the
  // token only ever carries `uid` (the account id), never a baked-in role —
  // so deleting the account revokes it instantly, with no separate bookkeeping.
  const session = decodeSessionToken(getCookie(event, SESSION_COOKIE))
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  if (session.uid) {
    const viewer = getUser(session.uid)
    if (!viewer) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    if (!scopeAllows('read', event.method, path))
      throw createError({ statusCode: 403, statusMessage: 'this account is read-only' })
    return
  }
  // No uid → the admin. Full access, exactly today's behavior.
})
