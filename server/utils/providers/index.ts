import type { DomainProvider } from './types'
import { createNpmProvider } from './npm'
import { createTraefikProvider } from './traefik'
import { createCaddyProvider } from './caddy'
import { getConfig } from '../config'

/**
 * Pick the active domain provider.
 * - DOMAIN_PROVIDER=npm|traefik|caddy forces a choice.
 * - Otherwise auto-detect: NPM (if NPM_CONF_DIR) → Caddy (if CADDYFILE_PATH) →
 *   Traefik (zero-config: reads Docker labels; empty if you don't use it).
 */
export function getDomainProvider(): DomainProvider | null {
  const cfg = getConfig()

  switch (cfg.domainProvider) {
    case 'npm':
      return cfg.npmConfDir ? createNpmProvider(cfg.npmConfDir) : null
    case 'caddy':
      return cfg.caddyfilePath ? createCaddyProvider(cfg.caddyfilePath) : null
    case 'traefik':
      return createTraefikProvider()
  }

  // auto
  if (cfg.npmConfDir) return createNpmProvider(cfg.npmConfDir)
  if (cfg.caddyfilePath) return createCaddyProvider(cfg.caddyfilePath)
  return createTraefikProvider()
}
