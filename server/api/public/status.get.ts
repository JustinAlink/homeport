import { getConfig } from '../../utils/config'
import { cachedPublicStatus, STATUS_CACHE_MS } from '../../utils/status-page'
import { normalizeTzOffset } from '../../../shared/utils/status-page.ts'

// GET /api/public/status[?tz=<Date#getTimezoneOffset()>]: the data of the public
// status page at /status. No login: server/middleware/auth.ts lets it through
// only while the page is switched on. What it holds is fixed by buildPublicStatus
// (title, notice, the picked items' names, state and uptime), and it comes from a
// 30 second cache per time zone, so asking often costs homeport nothing.
export default defineEventHandler((event) => {
  // Switched off. Only a signed-in caller gets this far (anyone else got the 401
  // every unknown /api path gets), and it gets the router's own "not found".
  if (!getConfig().statusPageEnabled) {
    const u = getRequestURL(event)
    const path = u.pathname + u.search
    throw createError({ statusCode: 404, statusMessage: `Page not found: ${path}`, data: { path } })
  }
  setResponseHeader(event, 'cache-control', `public, max-age=${STATUS_CACHE_MS / 1000}`)
  return cachedPublicStatus(normalizeTzOffset(getQuery(event).tz))
})
