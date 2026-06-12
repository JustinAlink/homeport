import type { AdminRoute, NewRoute } from './types'

// Pure builders/mappers for the Caddy admin API config JSON. No I/O.
// homeport-created routes carry @id = "homeport-<slug>" so update/delete can
// address them at /id/<@id>; other routes are listed read-only.

export const HP_PREFIX = 'homeport-'

/** Find the name of the HTTP server that listens on :443 (else the first server). */
export function findHttpsServer(config: any): string | null {
  const servers: Record<string, any> = config?.apps?.http?.servers || {}
  const names = Object.keys(servers)
  if (!names.length) return null
  for (const name of names) {
    const listen: string[] = servers[name]?.listen || []
    if (listen.some((l) => l.endsWith(':443') || l === ':443')) return name
  }
  return names[0]
}

export function buildCaddyRoute(route: NewRoute, slug: string): any {
  return {
    '@id': HP_PREFIX + slug,
    match: [{ host: route.domains }],
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: `${route.upstreamHost}:${route.upstreamPort}` }],
      },
    ],
    terminal: true,
  }
}

/** Map one Caddy route object → AdminRoute (or null if it's not a host/reverse_proxy route). */
export function caddyRouteFrom(routeObj: any, ssl: boolean): AdminRoute | null {
  const id = routeObj?.['@id']
  const host: string[] = routeObj?.match?.flatMap((m: any) => m?.host || []) || []
  if (!host.length) return null
  const rp = (routeObj?.handle || []).find((h: any) => h?.handler === 'reverse_proxy')
  const dial: string = rp?.upstreams?.[0]?.dial || ''
  const [uhost, uport] = dial.split(':')
  if (!uhost) return null
  return {
    id: typeof id === 'string' ? id : '',
    domains: host,
    upstreamHost: uhost,
    upstreamPort: Number(uport) || (ssl ? 443 : 80),
    ssl,
    managed: typeof id === 'string' && id.startsWith(HP_PREFIX),
  }
}

/** Pull every reverse-proxy route out of a full Caddy config (for listing). */
export function caddyRoutesFromConfig(config: any): AdminRoute[] {
  const servers: Record<string, any> = config?.apps?.http?.servers || {}
  const https = findHttpsServer(config)
  const out: AdminRoute[] = []
  for (const [name, srv] of Object.entries<any>(servers)) {
    for (const r of srv?.routes || []) {
      const route = caddyRouteFrom(r, name === https)
      if (route) out.push(route)
    }
  }
  return out
}
