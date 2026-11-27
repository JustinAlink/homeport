// Where to go after signing in, from a ?returnTo= value. Only a path on this site
// qualifies: anything else ("//evil.example", "https://...", "/\\evil") would turn
// the login page into an open redirect. The value is resolved the way a browser
// resolves a Location header (which also drops tabs and newlines, so "/\t/evil"
// would become "//evil"), and only a same-origin result is kept. API paths and the
// login page itself are refused too: landing on raw JSON or a login loop after a
// sign-in is never what anyone meant.
const BASE = 'http://homeport.invalid'

export function safeReturnTo(p: unknown): string {
  if (typeof p !== 'string' || !p.startsWith('/')) return '/'
  let u: URL
  try {
    u = new URL(p, BASE)
  } catch {
    return '/'
  }
  if (u.origin !== BASE) return '/'
  const out = `${u.pathname}${u.search}${u.hash}`
  if (!out.startsWith('/') || out.startsWith('//') || out.startsWith('/api/') || out === '/api' || out.startsWith('/login')) return '/'
  return out.length > 512 ? '/' : out
}
