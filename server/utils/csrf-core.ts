// Cross-origin request protection, kept pure so it can be unit-tested.
//
// The session cookie is SameSite=Lax, which stops other SITES but not other
// ORIGINS on the same site: another app on the same IP at a different port, or a
// sibling subdomain. On a homelab that is exactly where the other apps live, so one
// XSS in any of them could POST to homeport (deploy a privileged container) or open
// its terminal WebSocket with the user's cookie. This mirrors Go 1.25's
// CrossOriginProtection: Sec-Fetch-Site first (every current browser sends it),
// then Origin against Host for older browsers. A request with neither header did
// not come from a browser, so there is no ambient cookie to abuse (curl and API
// token scripts land here).

export type HeaderGetter = (name: string) => string | null | undefined

/** Methods that change state: the only ones a forged cross-origin form or fetch matters for. */
export function isUnsafeMethod(method: string): boolean {
  const m = (method || '').toUpperCase()
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS'
}

/** True when a browser sent this request from a page that is not homeport's own origin. */
export function isCrossOrigin(get: HeaderGetter): boolean {
  const site = (get('sec-fetch-site') || '').trim().toLowerCase()
  // 'none' is a user action (typed URL, bookmark), not a page making the request.
  if (site) return site !== 'same-origin' && site !== 'none'

  const origin = (get('origin') || '').trim()
  if (!origin) return false
  let originHost: string
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return true // "null" (sandboxed iframe, file://) or garbage: never our own page
  }
  // A reverse proxy that rewrites Host usually passes the public one on, so accept
  // either. A page cannot forge X-Forwarded-Host cross-origin: a custom header
  // forces a CORS preflight, which homeport never answers.
  const candidates = [get('host'), ...(get('x-forwarded-host') || '').split(',')]
    .map((h) => (h || '').trim().toLowerCase())
    .filter(Boolean)
  return !candidates.includes(originHost)
}
