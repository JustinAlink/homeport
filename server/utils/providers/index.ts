import type { DomainProvider } from './types'
import type { HostConfig } from '../hosts'
import { createNpmProvider } from './npm'
import { createTraefikProvider } from './traefik'
import { createCaddyProvider } from './caddy'

/**
 * Pick the active domain provider for a host.
 * - host.domainProvider = npm|traefik|caddy forces a choice.
 * - Otherwise auto-detect: NPM (if npmConfDir) → Caddy (if caddyfilePath) → Traefik.
 */
export function getDomainProviderFor(host: HostConfig): DomainProvider | null {
  switch ((host.domainProvider || '').toLowerCase()) {
    case 'npm':
      return host.npmConfDir ? createNpmProvider(host.npmConfDir) : null
    case 'caddy':
      return host.caddyfilePath ? createCaddyProvider(host.caddyfilePath) : null
    case 'traefik':
      return createTraefikProvider(host)
  }

  if (host.npmConfDir) return createNpmProvider(host.npmConfDir)
  if (host.caddyfilePath) return createCaddyProvider(host.caddyfilePath)
  return createTraefikProvider(host)
}
