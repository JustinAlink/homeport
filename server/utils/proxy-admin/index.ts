import type { ProxyAdmin } from './types'
import type { HostConfig } from '../hosts'
import { getConfig } from '../config'
import { createNpmAdmin } from './npm'
import { createCaddyAdmin } from './caddy'
import { createTraefikFileAdmin } from './traefik-file'
import { demoProxyAdmin } from '../demo'

/**
 * Pick the write-side proxy admin for a host. Aligns with the read-side provider:
 * NPM needs API creds, Caddy needs the admin URL, Traefik-file needs the file/dir.
 * Returns null when proxy admin isn't configured for the host.
 */
export function getProxyAdminFor(host: HostConfig): ProxyAdmin | null {
  if (getConfig().demo) return demoProxyAdmin()

  const provider = (host.domainProvider || '').toLowerCase()
  const npmReady = host.npmApiUrl && host.npmApiIdentity && host.npmApiSecret
  const caddyReady = !!host.caddyAdminUrl
  const traefikReady = !!host.traefikFilePath

  switch (provider) {
    case 'npm':
      return npmReady ? npmAdmin(host) : null
    case 'caddy':
      return caddyReady ? createCaddyAdmin(host.caddyAdminUrl!) : null
    case 'traefik-file':
    case 'traefikfile':
      return traefikReady ? createTraefikFileAdmin(host.traefikFilePath!) : null
  }

  // auto: whichever admin is configured
  if (npmReady) return npmAdmin(host)
  if (caddyReady) return createCaddyAdmin(host.caddyAdminUrl!)
  if (traefikReady) return createTraefikFileAdmin(host.traefikFilePath!)
  return null
}

const npmAdmin = (host: HostConfig) =>
  createNpmAdmin({ url: host.npmApiUrl!, identity: host.npmApiIdentity!, secret: host.npmApiSecret! })
