import type { DomainProvider, Route } from './types'
import type { HostConfig } from '../hosts'

// Extract Host(`a.com`, `b.com`) hostnames from a Traefik router rule.
function hostsFromRule(rule: string): string[] {
  const out: string[] = []
  for (const host of rule.matchAll(/Host\(([^)]*)\)/g)) {
    for (const q of host[1].matchAll(/[`'"]([^`'"]+)[`'"]/g)) out.push(q[1])
  }
  return out
}

/**
 * Build a route from one container's Traefik labels. Pure — exported for tests.
 *   traefik.http.routers.<r>.rule = Host(`app.example.com`)
 *   traefik.http.routers.<r>.tls  = true                 (or entrypoints=websecure)
 *   traefik.http.services.<s>.loadbalancer.server.port = 8080
 */
export function parseTraefikContainer(name: string, labels: Record<string, string>): Route | null {
  if (labels['traefik.enable'] === 'false') return null

  const domains: string[] = []
  let ssl = false
  let port: number | null = null

  for (const [k, v] of Object.entries(labels)) {
    if (/^traefik\.http\.routers\.[^.]+\.rule$/.test(k)) domains.push(...hostsFromRule(v))
    else if (/^traefik\.http\.routers\.[^.]+\.tls(\..+)?$/.test(k) && v !== 'false') ssl = true
    else if (/^traefik\.http\.routers\.[^.]+\.entrypoints$/.test(k) && /websecure|https/i.test(v)) ssl = true
    else if (/^traefik\.http\.services\.[^.]+\.loadbalancer\.server\.port$/.test(k)) port = Number(v) || port
  }

  if (!domains.length) return null
  return { domains: [...new Set(domains)], upstreamHost: name, upstreamPort: port || 80, ssl }
}

export function createTraefikProvider(host: HostConfig): DomainProvider {
  return {
    name: 'Traefik',
    async getRoutes(): Promise<Route[]> {
      const { listContainersFor } = await import('../docker') // lazy: keeps the parser test-isolated
      const containers = await listContainersFor(host)
      const routes: Route[] = []
      for (const c of containers) {
        const r = parseTraefikContainer(c.name, c.labels)
        if (r) routes.push(r)
      }
      return routes
    },
  }
}
