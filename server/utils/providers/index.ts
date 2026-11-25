import type { DomainProvider } from './types'
import type { HostConfig } from '../hosts'
import type { RawContainer } from '../docker'
import { createNpmProvider } from './npm'
import { createCaddyProvider } from './caddy'
import { createNginxProvider } from './nginx'
import { createTraefikFileProvider } from './traefik-file'
import { createTraefikApiProvider } from './traefik-api'
import { planSources, readLabelSources, type SourcePlan, type SourceResult } from './sources-core'
import { log } from '../log'

// How sources are chosen and combined is decided in sources-core.ts (pure). This
// file turns that plan into readers: the primary one (a config file or an API) and
// the label sources, which parse the container list the caller already has.

/** The config-file or API reader for a host, or null when it reads labels only. */
export function primaryProviderFor(host: HostConfig, plan: SourcePlan = planSources(host)): DomainProvider | null {
  switch (plan.primary) {
    case 'npm':
      return createNpmProvider(host.npmConfDir!)
    case 'caddy':
      return createCaddyProvider(host.caddyfilePath!)
    case 'nginx':
      return createNginxProvider(host.nginxConfDir!)
    case 'traefik-file':
      return createTraefikFileProvider(host.traefikFilePath!)
    case 'traefik-api':
      return createTraefikApiProvider(host.traefikApiUrl!, { user: host.traefikApiUser, password: host.traefikApiPassword })
  }
  return null
}

export interface SourceRead extends SourceResult {
  /** why this source gave nothing (e.g. the Traefik API refused the login) */
  error?: string
}

// last error per host + source, so a proxy API that is down logs once, not every tick
const lastError = new Map<string, string>()

/**
 * Read the primary source. Fails open: an unreachable Traefik API means no domains
 * from it, never a host marked offline (the domains are cosmetic, the containers
 * are not). The error is logged once and returned for the settings test.
 */
export async function readPrimary(host: HostConfig, provider: DomainProvider | null): Promise<SourceRead | null> {
  if (!provider) return null
  const key = `${host.id}|${provider.name}`
  try {
    const routes = (await provider.getRoutes()).map((r) => (r.source ? r : { ...r, source: provider.name }))
    if (lastError.delete(key)) log.info('domains', `${provider.name} on ${host.name} answers again`)
    return { name: provider.name, routes, configured: true }
  } catch (e: any) {
    const message = String(e?.message || e)
    if (lastError.get(key) !== message) log.warn('domains', `${provider.name} on ${host.name}: ${message}`)
    lastError.set(key, message)
    return { name: provider.name, routes: [], configured: true, error: message }
  }
}

/** Every source of one host over its container list: the primary first, then labels. */
export async function readHostSources(host: HostConfig, containers: RawContainer[] | Promise<RawContainer[]>): Promise<SourceRead[]> {
  const plan = planSources(host)
  const [list, primary] = await Promise.all([containers, readPrimary(host, primaryProviderFor(host, plan))])
  return [...(primary ? [primary] : []), ...readLabelSources(plan, list)]
}
