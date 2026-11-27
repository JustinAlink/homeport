import { SESSION_COOKIE, decodeSessionToken } from '../utils/session'
import { authMode, trustedAuthHeader } from '../utils/auth'
import { forwardAuthUser } from '../utils/auth-core'
import { verifyApiToken } from '../utils/api-tokens'
import { getUser } from '../utils/users'
import { scopeAllows } from '../utils/api-tokens-core'
import { isCrossOrigin, isUnsafeMethod } from '../utils/csrf-core'
import { routedPath } from '../utils/request-path-core'

// Gate the API (pages redirect client-side). Fail-closed: a valid session is
// required unless auth is intentionally off (open mode). /api/auth/* and the
// first-run /api/setup are always reachable.
export default defineEventHandler((event) => {
  // The decoded path the router matches, never the raw URL: checking the raw
  // pathname let `/%61pi/backup` skip every rule below (see request-path-core.ts).
  const path = routedPath(event.path)
  if (path === null) throw createError({ statusCode: 400, statusMessage: 'Bad request path' })
  if (!path.startsWith('/api/')) return
  // Before anything else, including the public auth endpoints: a cross-origin page
  // must not log the user out, log them in as someone else, or claim setup.
  if (isUnsafeMethod(event.method) && isCrossOrigin((n) => getHeader(event, n)))
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request refused' })
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
    // Nor touch backups: the export carries the session secret (enough to forge an
    // admin cookie, which would undo every rule above) and a restore replaces it.
    if (path === '/api/backup' || path.startsWith('/api/backup/'))
      throw createError({ statusCode: 403, statusMessage: 'API tokens cannot export or restore backups' })
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
