import { getConfig } from '../../../utils/config'
import { signingKey } from '../../../utils/auth'
import { oidc, oidcConfiguration, redirectUri, ssoMissing } from '../../../utils/oidc'
import { packState, safeReturnTo, effectiveScopes } from '../../../utils/oidc-core'
import { log, warnOnce } from '../../../utils/log'

// Public (no session yet): send the browser to the identity provider. PKCE, state
// and nonce are fresh for every attempt and travel in a short-lived signed cookie,
// so the callback can prove the answer belongs to this browser's request.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (ssoMissing(cfg)) return sendRedirect(event, '/login?sso_error=config', 302)
  let config
  try {
    config = await oidcConfiguration(cfg)
  } catch (e) {
    log.warn('sso', `discovery at ${cfg.oidcIssuer} failed`, e)
    return sendRedirect(event, '/login?sso_error=config', 302)
  }
  const { scope, dropped } = effectiveScopes(cfg.oidcScopes, config.serverMetadata().scopes_supported)
  if (dropped.length) warnOnce(`sso-scopes:${dropped.join(',')}`, 'sso', `not asking for scope(s) ${dropped.join(', ')}: ${cfg.oidcIssuer} does not offer them`)
  const verifier = oidc.randomPKCECodeVerifier()
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(cfg),
    scope,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  })
  // Lax, not Strict: the provider's redirect back is a top-level cross-site
  // navigation, and a Strict cookie would not come along.
  setCookie(event, 'hp_oidc', packState({ v: verifier, s: state, n: nonce, r: safeReturnTo(getQuery(event).returnTo), iat: Date.now() }, signingKey()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.publicUrl.startsWith('https:'),
    path: '/api/auth/oidc',
    maxAge: 600,
  })
  return sendRedirect(event, url.href, 302)
})
