import { createHash } from 'node:crypto'
import * as client from 'openid-client'
import { getConfig, type HomeportConfig as Config } from './config'
import { redirectUriFor, pickClientAuth } from './oidc-core'

// OpenID Connect sign-in. openid-client does the protocol: discovery, the
// authorization code grant with PKCE, and ID token validation (signature against
// the provider's JWKS, issuer, audience, expiry, nonce). This file only holds the cached client configuration;
// the request handlers live in server/api/auth/oidc/.

let cached: { key: string; at: number; config: client.Configuration } | null = null
const TTL = 3600_000

/** What is missing before single sign-on can work, or null when it can. */
export function ssoMissing(cfg: Config = getConfig()): string | null {
  if (!cfg.oidcEnabled) return 'off'
  if (!cfg.publicUrl) return 'the public URL'
  if (!cfg.oidcIssuer) return 'the issuer URL'
  if (!cfg.oidcClientId) return 'the client ID'
  if (!cfg.oidcClientSecret) return 'the client secret'
  return null
}

/** The provider's configuration, discovered once an hour (and again when the settings change). */
export async function oidcConfiguration(
  cfg: Pick<Config, 'oidcIssuer' | 'oidcClientId' | 'oidcClientSecret'> = getConfig(),
  fresh = false,
): Promise<client.Configuration> {
  const key = `${cfg.oidcIssuer}|${cfg.oidcClientId}|${createHash('sha256').update(cfg.oidcClientSecret).digest('hex')}`
  if (!fresh && cached && cached.key === key && Date.now() - cached.at < TTL) return cached.config
  // An http:// issuer only makes sense on a private network; openid-client refuses
  // it unless told, and the settings page warns about it.
  const insecure = /^http:\/\//i.test(cfg.oidcIssuer)
  const discovered = await client.discovery(new URL(cfg.oidcIssuer), cfg.oidcClientId, cfg.oidcClientSecret, undefined, {
    ...(insecure ? { execute: [client.allowInsecureRequests] } : {}),
    timeout: 10,
  })
  // Rebuilt with the secret sent the way the provider wants it (pickClientAuth),
  // and with the ID token's signature checked against the provider's published
  // keys. openid-client skips that check by default (fine over HTTPS, where the
  // token comes straight from the provider), but homeport allows an http:// issuer
  // on a LAN, and a token signed with the client secret (HS256) proves little.
  const meta = discovered.serverMetadata()
  const auth = pickClientAuth(meta.token_endpoint_auth_methods_supported) === 'client_secret_post' ? client.ClientSecretPost(cfg.oidcClientSecret) : client.ClientSecretBasic(cfg.oidcClientSecret)
  const config = new client.Configuration(meta, cfg.oidcClientId, cfg.oidcClientSecret, auth)
  if (insecure) client.allowInsecureRequests(config)
  config.timeout = 10
  client.enableNonRepudiationChecks(config)
  cached = { key, at: Date.now(), config }
  return config
}

export const redirectUri = (cfg: Config = getConfig()) => redirectUriFor(cfg.publicUrl)

export { client as oidc }
