import type { ServiceDomain, UnmatchedRoute } from '../../../types/service.ts'
import type { Route } from './types.ts'

// Join proxy routes to containers. Pure, unit-tested.
// An upstream is matched by, in order:
//  - a container NAME (most proxy configs, and every label source);
//  - a container's OWN IP: the Traefik API reports the Docker provider's upstream
//    as the container's address on the shared network (http://172.18.0.3:80). It
//    reaches the app the same way a name does, so it counts as `via: 'name'`;
//  - a HOST IP plus a port published on the host (NPM's "172.17.0.1:9000").
// Checking a container's own IP first keeps a container-IP upstream from being
// pinned on whichever container happens to publish that port number on the host.

export interface JoinContainer {
  id: string
  name: string
  ports: { hostPort: number }[]
  /** the container's addresses on its networks */
  ips?: string[]
}

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')
const hostPort = (h: string, p: number) => (p ? `${h.includes(':') ? `[${h}]` : h}:${p}` : h)

export function joinRoutes(routes: Route[], containers: JoinContainer[]): { domainsById: Map<string, ServiceDomain[]>; unmatched: UnmatchedRoute[] } {
  const byName = new Map(containers.map((c) => [c.name, c]))
  const byIp = new Map<string, JoinContainer>()
  for (const c of containers) for (const ip of c.ips ?? []) if (ip) byIp.set(ip, c)

  // container id → domain → entry; one entry per domain, HTTPS winning over HTTP
  // (an HTTP router that only redirects and its HTTPS twin name the same domain)
  const perContainer = new Map<string, Map<string, ServiceDomain>>()
  const unmatched: UnmatchedRoute[] = []

  for (const route of routes) {
    let target: JoinContainer | undefined
    let via: 'name' | 'ip' = 'name'
    if (isIp(route.upstreamHost)) {
      target = byIp.get(route.upstreamHost)
      if (!target) {
        target = containers.find((c) => c.ports.some((p) => p.hostPort === route.upstreamPort))
        via = 'ip'
      }
    } else {
      target = byName.get(route.upstreamHost)
    }
    if (!target) {
      unmatched.push({ domains: route.domains, upstream: hostPort(route.upstreamHost, route.upstreamPort), ssl: route.ssl, ...(route.source ? { source: route.source } : {}) })
      continue
    }
    const list = perContainer.get(target.id) ?? new Map<string, ServiceDomain>()
    perContainer.set(target.id, list)
    const port = route.upstreamPort || undefined
    for (const d of route.domains) {
      const prev = list.get(d)
      if (prev && (prev.ssl || !route.ssl)) continue
      list.set(d, {
        domain: d,
        url: `${route.ssl ? 'https' : 'http'}://${d}`,
        ssl: route.ssl,
        via,
        ...(port ? { port } : {}),
        ...(route.source ? { source: route.source } : {}),
      })
    }
  }

  const domainsById = new Map<string, ServiceDomain[]>()
  for (const [id, m] of perContainer) domainsById.set(id, [...m.values()])
  return { domainsById, unmatched }
}
