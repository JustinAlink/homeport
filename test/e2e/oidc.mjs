// Single sign-on against a real OpenID provider: panva's oidc-provider (OpenID
// certified, and strict about PKCE, state, nonce and exact redirect URIs) runs in
// this process with three accounts, and homeport signs in through it as a browser
// would. Groups are only in userinfo here (the provider keeps the ID token lean by
// default), which is how Authelia behaves too.
import Provider from 'oidc-provider'
import { boot } from './harness.mjs'

const PORT = 3361
const IDP = 3362
const ISSUER = `http://127.0.0.1:${IDP}`
const SECRET = 'idp-client-secret-0123456789'
const GROUPS = { alice: ['homeport-admins'], bob: ['/family'], eve: ['strangers'] }

const provider = new Provider(ISSUER, {
  clients: [{ client_id: 'homeport', client_secret: SECRET, redirect_uris: [`http://127.0.0.1:${PORT}/api/auth/oidc/callback`], grant_types: ['authorization_code'], response_types: ['code'] }],
  pkce: { required: () => true },
  scopes: ['openid', 'profile', 'email', 'groups'],
  claims: { openid: ['sub'], profile: ['preferred_username', 'name'], groups: ['groups'] },
  findAccount: (_ctx, id) => ({ accountId: id, claims: () => ({ sub: `id-${id}`, preferred_username: id, name: id, groups: GROUPS[id] ?? [] }) }),
  features: { devInteractions: { enabled: true } },
  cookies: { keys: ['e2e-cookie-key'] },
})
provider.on('server_error', (_ctx, err) => console.error('idp error:', err))
// When set, the provider sends the browser back with a different state than it
// was given: what a login CSRF or a mixed-up second tab looks like to homeport.
let tamperState = false
provider.use(async (ctx, next) => {
  await next()
  const loc = ctx.response.get('location')
  if (tamperState && loc?.startsWith(`http://127.0.0.1:${PORT}/api/auth/oidc/callback`)) {
    const u = new URL(loc)
    u.searchParams.set('state', 'tampered-state-value-123456')
    ctx.redirect(u.href)
  }
})
const idp = provider.listen(IDP)

const { BASE, page, ctx, check, done, errs } = await boot({ port: PORT, allowErrors: [/status of 4\d\d/] })
const browser = ctx.browser()

// Admin configures SSO through the settings API, as the settings page does.
const save = (body) => page.request.post(`${BASE}/api/settings`, { data: body, headers: { origin: BASE } })
let r = await save({
  publicUrl: `${BASE}/`,
  oidcEnabled: true,
  oidcIssuer: ISSUER,
  oidcClientId: 'homeport',
  oidcClientSecret: SECRET,
  oidcScopes: 'profile email groups',
  oidcAdminGroups: 'homeport-admins',
  oidcViewerGroups: 'family, friends',
})
check('admin saves the SSO settings', r.ok(), `${r.status()} ${await r.text()}`)
const view = await (await page.request.get(`${BASE}/api/settings`)).json()
const s = view.settings ?? view
check('the client secret never comes back to the browser', !JSON.stringify(view).includes(SECRET) && s.oidcClientSecretSet === true)
check('openid is always among the scopes', String(s.oidcScopes).split(' ').includes('openid'))
check('a Keycloak-style "/family" setting normalises', JSON.stringify(s.oidcViewerGroups) === '["family","friends"]', JSON.stringify(s.oidcViewerGroups))

// Settings page: redirect URI shown, test button reaches the provider.
await page.goto(`${BASE}/settings?tab=security`)
await page.locator('#sso').waitFor()
check('settings shows the redirect URI to paste', (await page.locator('#sso').innerText()).includes(`${BASE}/api/auth/oidc/callback`))
await page.locator('#sso').getByRole('button', { name: 'Test the provider' }).click()
const status = page.locator('#sso [role="status"]')
await status.waitFor()
check('provider test succeeds against the real provider', /reached|ok|found/i.test(await status.innerText()), await status.innerText())

// One fresh, logged-out browser per person, signing in by clicking through.
async function signIn(user, { path = '/login', expectProvider = true } = {}) {
  const c = await browser.newContext()
  const p = await c.newPage()
  p.on('pageerror', (e) => errs.push(`pageerror (${user}): ${e.message}`))
  const trail = []
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) trail.push(f.url()) })
  p.trail = trail
  await p.goto(`${BASE}${path}`)
  await p.getByRole('link', { name: /^Sign in with/ }).click()
  if (expectProvider) {
    await p.waitForURL((u) => u.origin === ISSUER)
    await p.locator('input[name="login"]').fill(user)
    await p.locator('input[name="password"]').fill('anything')
    await p.locator('button[type="submit"]').click()
    // first visit: the provider asks to authorise homeport
    await p.waitForURL((u) => u.origin === BASE || /consent|interaction/.test(u.pathname))
    if (new URL(p.url()).origin === ISSUER) await p.locator('button[type="submit"]').click()
  }
  await p.waitForURL((u) => u.origin === BASE && !u.pathname.startsWith('/api/'))
  await p.waitForLoadState('load')
  return { c, p }
}
const me = async (p) => (await p.request.get(`${BASE}/api/auth/me`)).json().catch(() => null)

// A deep link survives the login page, for a password sign-in too
{
  const c = await browser.newContext()
  const p = await c.newPage()
  await p.goto(`${BASE}/updates`)
  await p.waitForURL((u) => u.pathname === '/login')
  check('a signed-out deep link is remembered', new URL(p.url()).searchParams.get('returnTo') === '/updates', p.url())
  await p.locator('#password').fill('pw-test')
  await p.getByRole('button', { name: 'Sign in', exact: true }).click()
  await p.waitForURL((u) => u.pathname === '/updates')
  check('...and the password sign-in returns to it', true)
  await c.close()
}

// Admin by group
{
  const { c, p } = await signIn('alice', { path: '/login?returnTo=%2Fupdates' })
  check('alice (homeport-admins) lands where she was going', new URL(p.url()).pathname === '/updates', p.url())
  const m = await me(p)
  check('alice is an admin, with her own account', m?.role === 'admin' && m.user === 'alice', JSON.stringify(m))
  const w = await p.request.post(`${BASE}/api/settings`, { data: { oidcButtonLabel: '' }, headers: { origin: BASE } })
  check('an SSO admin can change settings', w.ok(), String(w.status()))
  // one person can be signed out without signing out everyone
  const alice = (await (await page.request.get(`${BASE}/api/users`)).json()).users.find((u) => u.username === 'alice')
  check('alice is listed as an SSO admin account', alice?.role === 'admin' && !!alice?.sso, JSON.stringify(alice))
  const out = await page.request.post(`${BASE}/api/users/signout`, { data: { id: alice?.id }, headers: { origin: BASE } })
  check('the admin signs alice out', out.ok(), String(out.status()))
  check('...her session ends at once', (await p.request.get(`${BASE}/api/services`)).status() === 401)
  check('...and the primary admin stays signed in', (await page.request.get(`${BASE}/api/services`)).status() === 200)
  await page.goto(`${BASE}/settings?tab=security`)
  await page.locator('#user-accounts').waitFor()
  check('user accounts offer a per-person sign-out', await page.locator('#user-accounts').getByRole('button', { name: 'Sign alice out on every device' }).isVisible())
  await c.close()
}

// Groups decide at every sign-in: alice moved to a viewer group is read-only next time
{
  await save({ oidcAdminGroups: 'nobody-here', oidcViewerGroups: 'family, friends, homeport-admins' })
  const { c, p } = await signIn('alice')
  check('demoted at the provider, alice comes back read-only', (await me(p))?.role === 'viewer')
  check('...and cannot change settings any more', (await p.request.post(`${BASE}/api/settings`, { data: { oidcButtonLabel: '' }, headers: { origin: BASE } })).status() === 403)
  await c.close()
  await save({ oidcAdminGroups: 'homeport-admins', oidcViewerGroups: 'family, friends' })
}

// Viewer by group, created on first sign-in, matched again on the second
{
  const { c, p } = await signIn('bob')
  const m = await me(p)
  check('bob ("/family") is a read-only viewer', m?.role === 'viewer' && m.user === 'bob', JSON.stringify(m))
  const w = await p.request.post(`${BASE}/api/settings`, { data: { oidcEnabled: false }, headers: { origin: BASE } })
  check('a viewer cannot change settings', w.status() === 403, String(w.status()))
  await c.close()
  const again = await signIn('bob')
  check('bob signing in again is the same account', (await me(again.p))?.user === 'bob')
  await again.c.close()
  const users = (await (await page.request.get(`${BASE}/api/users`)).json()).users
  const bobs = users.filter((u) => u.sso?.sub === 'bob')
  check('exactly one account exists for bob, linked to the provider', bobs.length === 1 && bobs[0].sso.iss.startsWith(ISSUER), JSON.stringify(users))
  check('an SSO account has no password to try', !(await page.request.post(`${BASE}/api/auth/login`, { data: { username: 'bob', password: '' }, headers: { origin: BASE } })).ok())
  await page.goto(`${BASE}/settings?tab=security`)
  await page.locator('#user-accounts').waitFor()
  check('user accounts marks both SSO accounts (alice, bob)', (await page.locator('#user-accounts').getByText('SSO', { exact: true }).count()) === 2)
}

// In no allowed group: the provider let eve in, homeport does not
{
  const { c, p } = await signIn('eve')
  check('eve (strangers) is turned away with a reason', new URL(p.url()).searchParams.get('sso_error') === 'denied', p.url())
  check('the login page explains why', await p.getByText('not in a group allowed into homeport').waitFor({ timeout: 5000 }).then(() => true, () => false))
  check('eve has no session', (await p.request.get(`${BASE}/api/services`)).status() === 401)
  await c.close()
}

// A forged or replayed callback, with no state cookie from this browser
{
  const c = await browser.newContext()
  const p = await c.newPage()
  await p.goto(`${BASE}/api/auth/oidc/callback?code=stolen&state=whatever`)
  check('a callback without this browser\'s state is refused', new URL(p.url()).searchParams.get('sso_error') === 'state', p.url())
  check('it leaves no session', (await p.request.get(`${BASE}/api/services`)).status() === 401)
  await c.close()
}

// The callback with a valid cookie but a changed state parameter
{
  const c = await browser.newContext()
  const p = await c.newPage()
  await p.goto(`${BASE}/login`)
  await p.getByRole('link', { name: /Sign in with SSO/ }).click()
  await p.waitForURL((u) => u.origin === ISSUER)
  tamperState = true
  await p.locator('input[name="login"]').fill('alice')
  await p.locator('input[name="password"]').fill('x')
  await p.locator('button[type="submit"]').click()
  await p.waitForURL((u) => u.origin === BASE || /consent|interaction/.test(u.pathname))
  if (new URL(p.url()).origin === ISSUER) await p.locator('button[type="submit"]').click()
  await p.waitForURL((u) => u.origin === BASE && u.pathname === '/login')
  tamperState = false
  check('a changed state parameter is refused', new URL(p.url()).searchParams.get('sso_error') === 'exchange', p.url())
  check('...and grants nothing', (await p.request.get(`${BASE}/api/services`)).status() === 401)
  await c.close()
}

// Saving the page again with the secret left blank keeps it
r = await save({ oidcClientSecret: '', oidcAutoRedirect: true, oidcHidePassword: true, oidcButtonLabel: 'Sign in with Example ID' })
check('saving with a blank secret is accepted', r.ok())
{
  const c = await browser.newContext()
  const p = await c.newPage()
  await p.goto(`${BASE}/login`)
  await p.waitForURL((u) => u.origin === ISSUER)
  check('auto-redirect goes straight to the provider', true)
  await p.goto(`${BASE}/login?loggedout=1`)
  await p.getByRole('link', { name: 'Sign in with Example ID' }).waitFor()
  await p.waitForTimeout(500)
  check('after a logout it does not bounce back to the provider', new URL(p.url()).origin === BASE)
  check('the custom button label is used', await p.getByRole('link', { name: 'Sign in with Example ID' }).isVisible())
  check('the password form is hidden', !(await p.locator('input[type="password"]').isVisible()))
  await p.goto(`${BASE}/login?local=1`)
  await p.getByRole('link', { name: 'Sign in with Example ID' }).waitFor()
  check('?local=1 always brings the password form back', await p.locator('input[type="password"]').isVisible(), `${p.url()} :: ${(await p.locator('main, body').first().innerText()).slice(0, 300)}`)
  await c.close()
  const again = await signIn('alice', { path: '/login?loggedout=1', expectProvider: true })
  check('the kept secret still signs in', (await me(again.p))?.role === 'admin')
  await again.c.close()
}

// A viewer logging out ends their own sessions on every device, nobody else's
{
  // auto-redirect is on by now: start from after a logout, which never redirects
  const a = await signIn('bob', { path: '/login?loggedout=1' })
  const b = await signIn('bob', { path: '/login?loggedout=1' })
  await a.p.request.post(`${BASE}/api/auth/logout`, { headers: { origin: BASE } })
  check('bob logging out on one device signs out his other one too', (await b.p.request.get(`${BASE}/api/services`)).status() === 401)
  check('...and not the admin', (await page.request.get(`${BASE}/api/services`)).status() === 200)
  await a.c.close(); await b.c.close()
}

// Turned off: the endpoints refuse and the login page shows no button
const stillIn = await signIn('bob', { path: '/login?loggedout=1' })
check('bob is signed in before SSO is turned off', (await stillIn.p.request.get(`${BASE}/api/services`)).status() === 200)
await save({ oidcEnabled: false })
check('turning SSO off ends the SSO accounts\' sessions', (await stillIn.p.request.get(`${BASE}/api/services`)).status() === 401)
await stillIn.c.close()
{
  const c = await browser.newContext()
  const p = await c.newPage()
  await p.goto(`${BASE}/api/auth/oidc/start`)
  check('with SSO off, start refuses', new URL(p.url()).searchParams.get('sso_error') === 'config', p.url())
  await p.goto(`${BASE}/login`)
  await p.locator('input[type="password"]').waitFor()
  check('with SSO off, the login page has no SSO button', !(await p.getByRole('link', { name: /Sign in with/ }).count()))
  check('...and shows the password form even though it was set to hide', await p.locator('input[type="password"]').isVisible())
  await c.close()
}

await done()
idp.close()
