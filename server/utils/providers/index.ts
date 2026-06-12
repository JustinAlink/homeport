import type { DomainProvider } from './types'
import type { HostConfig } from '../hosts'
import { createNpmProvider } from './npm'
import { createTraefikProvider } from './traefik'
import { createCaddyProvider } from './caddy'
import { createNginxProvider } from './nginx'
import { createTraefikFileProvider } from './traefik-file'

/**
 * Pick the active domain provider for a host.
 * - host.domainProvider = npm|caddy|nginx|traefik-file|traefik forces a choice.
 * - Otherwise auto-detect by which config path is set, with label-based Traefik last.
 */
export function getDomainProviderFor(host: HostConfig): DomainProvider | null {
  switch ((host.domainProvider || '').toLowerCase()) {
    case 'npm':
      return host.npmConfDir ? createNpmProvider(host.npmConfDir) : null
    case 'caddy':
      return host.caddyfilePath ? createCaddyProvider(host.caddyfilePath) : null
    case 'nginx':
      return host.nginxConfDir ? createNginxProvider(host.nginxConfDir) : null
    case 'traefik-file':
    case 'traefikfile':
      return host.traefikFilePath ? createTraefikFileProvider(host.traefikFilePath) : null
    case 'traefik':
      return createTraefikProvider(host)
  }

  if (host.npmConfDir) return createNpmProvider(host.npmConfDir)
  if (host.caddyfilePath) return createCaddyProvider(host.caddyfilePath)
  if (host.nginxConfDir) return createNginxProvider(host.nginxConfDir)
  if (host.traefikFilePath) return createTraefikFileProvider(host.traefikFilePath)
  return createTraefikProvider(host)
}
