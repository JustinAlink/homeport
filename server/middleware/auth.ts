import { SESSION_COOKIE, verifySessionToken } from '../utils/session'

// Gate the API (the pages handle their own redirect client-side). Fail-closed:
// without a valid session, every /api/* call except login/logout returns 401.
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  if (path === '/api/auth/login' || path === '/api/auth/logout') return

  if (!verifySessionToken(getCookie(event, SESSION_COOKIE))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
