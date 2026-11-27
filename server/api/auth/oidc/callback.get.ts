import { getConfig } from '../../../utils/config'
import { signingKey } from '../../../utils/auth'
import { SESSION_COOKIE, createSessionToken } from '../../../utils/session'
import { oidc, oidcConfiguration, redirectUri, ssoMissing } from '../../../utils/oidc'
import { unpackState, claimAt, groupsFrom, roleFor, type SsoError } from '../../../utils/oidc-core'
import { findOrCreateSsoUser } from '../../../utils/users'
import { log } from '../../../utils/log'

// Public: the identity provider sends the browser back here. Everything that
// decides who gets in happens on this request, and every failure lands on the
// login page with a reason; nothing here ever grants access by default.
export default defineEventHandler(async (event) => {
  const fail = (code: SsoError, why?: unknown) => {
    if (why) log.warn('sso', `sign-in refused (${code})`, why)
    return sendRedirect(event, `/login?sso_error=${code}`, 302)
  }
  const cfg = getConfig()
  if (ssoMissing(cfg)) return fail('config')
  const st = unpackState(getCookie(event, 'hp_oidc'), signingKey(), Date.now())
  deleteCookie(event, 'hp_oidc', { path: '/api/auth/oidc' })
  if (!st) return fail('state')
  const q = getQuery(event)
  if (q.error) return fail('provider', `${q.error}${q.error_description ? `: ${q.error_description}` : ''}`)

  let config
  try {
    config = await oidcConfiguration(cfg)
  } catch (e) {
    return fail('config', e)
  }
  // The URL the provider redirected to, rebuilt from the configured public URL
  // rather than this request's Host header (which a proxy may have rewritten).
  const current = new URL(`${redirectUri(cfg)}${getRequestURL(event).search}`)
  let tokens
  try {
    tokens = await oidc.authorizationCodeGrant(config, current, { pkceCodeVerifier: st.v, expectedState: st.s, expectedNonce: st.n, idTokenExpected: true })
  } catch (e) {
    return fail('exchange', e)
  }
  const claims = tokens.claims()
  if (!claims?.sub) return fail('exchange', 'no subject in the ID token')
  // Groups may be in the ID token, in userinfo (Authelia), or both: take both.
  let info: Record<string, unknown> = {}
  try {
    info = (await oidc.fetchUserInfo(config, tokens.access_token, claims.sub)) as Record<string, unknown>
  } catch {
    // no userinfo endpoint, or it refused: the ID token's claims stand alone
  }
  const groups = [...new Set([...groupsFrom(claimAt(claims, cfg.oidcGroupsClaim)), ...groupsFrom(claimAt(info, cfg.oidcGroupsClaim))])]
  const role = roleFor(groups, cfg.oidcAdminGroups, cfg.oidcViewerGroups)
  const who = String(info.preferred_username ?? claims.preferred_username ?? info.email ?? claims.email ?? claims.sub)
  if (!role) return fail('denied', `${who}: groups [${groups.join(', ') || 'none'}] in claim "${cfg.oidcGroupsClaim}" match no admin or viewer group`)

  // Admins get an account too (not the primary admin's session), so one person can
  // be signed out on their own, and their role follows their groups at every sign-in.
  let uid: string
  try {
    uid = findOrCreateSsoUser(String(claims.iss), claims.sub, { ...info, ...claims }, role).id
  } catch (e) {
    return fail('config', e)
  }
  // The provider handled the login and its MFA, so homeport's own TOTP step is
  // not asked again; API tokens and forward-auth are unaffected.
  setCookie(event, SESSION_COOKIE, createSessionToken(uid), {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.publicUrl.startsWith('https:'),
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  log.info('sso', `${who} signed in as ${role}`)
  return sendRedirect(event, st.r, 302)
})
