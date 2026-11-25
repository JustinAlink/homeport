// Send a signed-out visitor to the login page, remembering where they were so
// signing in (password or SSO) brings them back. On the login page itself this
// does nothing: a background request answering 401 there is expected, and
// navigating would wipe the page's own query (?local=1, ?sso_error=..., ?returnTo=).
export function toLogin() {
  const route = useRoute()
  if (route.path === '/login') return
  const back = route.fullPath
  return navigateTo(back && back !== '/' ? `/login?returnTo=${encodeURIComponent(back)}` : '/login')
}
