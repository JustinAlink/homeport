import { createHash } from 'node:crypto'
import * as client from 'openid-client'
import { getConfig, type HomeportConfig as Config } from './config'
import { redirectUriFor } from './oidc-core'

// OpenID Connect sign-in. openid-client does the protocol: discovery, the
// authorization code grant with PKCE, and ID token validation (signature, issuer,
// audience, expiry, nonce). This file only holds the cached client configuration;
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
  const config = await client.discovery(new URL(cfg.oidcIssuer), cfg.oidcClientId, cfg.oidcClientSecret, undefined, {
    ...(insecure ? { execute: [client.allowInsecureRequests] } : {}),
    timeout: 10,
  })
  cached = { key, at: Date.now(), config }
  return config
}

export const redirectUri = (cfg: Config = getConfig()) => redirectUriFor(cfg.publicUrl)

export { client as oidc }
