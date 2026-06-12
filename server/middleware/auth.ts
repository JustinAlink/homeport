import { SESSION_COOKIE, verifySessionToken } from '../utils/session'
import { authMode } from '../utils/auth'

// Gate the API (pages redirect client-side). Fail-closed: a valid session is
// required unless auth is intentionally off (open mode). /api/auth/* and the
// first-run /api/setup are always reachable.
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  if (path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/setup') return

  // open mode (no password, user skipped it or the volume is read-only) → no auth
  if (authMode() === 'open') return

  if (!verifySessionToken(getCookie(event, SESSION_COOKIE))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
