// The path access checks must look at. h3 percent-decodes the path before routing
// (event.path), so a check on the raw URL can be walked around: `/%61pi/backup`
// is not under "/api/" as written, yet it routes to /api/backup. Every check in the
// auth middleware therefore uses this decoded form, the exact string the router
// matches. Pure, unit-tested.

/**
 * The routed path without its query, or null for a path to refuse outright:
 * backslashes, NUL, dot segments, and encoded slashes or backslashes. No homeport
 * route uses them, and proxies, routers and file servers each read them differently.
 */
export function routedPath(eventPath: string): string | null {
  const q = eventPath.indexOf('?')
  const p = q === -1 ? eventPath : eventPath.slice(0, q)
  if (!p.startsWith('/')) return null
  if (/[\\\0]|%2f|%5c|%00/i.test(p)) return null
  if (/(^|\/)\.{1,2}(\/|$)/.test(p)) return null
  return p
}
