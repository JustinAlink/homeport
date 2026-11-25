// Where to go after signing in, from a ?returnTo= value. Only a path on this site
// qualifies: anything else ("//evil.example", "https://...", "/\\evil") would turn
// the login page into an open redirect. API paths are refused too, since landing
// on raw JSON after a sign-in is never what anyone meant.
export function safeReturnTo(p: unknown): string {
  const s = typeof p === 'string' ? p : ''
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\') || s.startsWith('/api/') || s.startsWith('/login')) return '/'
  return s.slice(0, 512)
}
