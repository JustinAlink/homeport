import type { AdminRoute, NewRoute } from './types'

// Pure read-modify-write of a Traefik dynamic-config document (already parsed
// from YAML/TOML by confbox). homeport ONLY ever touches keys named
// "homeport-<slug>" under http.routers / http.services — user-authored routers
// are listed read-only and never modified or removed.

export const HP_PREFIX = 'homeport-'

function rule(domains: string[]): string {
  return domains.map((d) => `Host(\`${d}\`)`).join(' || ')
}

/** Add or replace the homeport-<slug> router + service. Returns a new document. */
export function upsertRoute(doc: any, route: NewRoute, slug: string): any {
  const key = HP_PREFIX + slug
  const next = doc ? structuredClone(doc) : {}
  next.http = next.http || {}
  next.http.routers = next.http.routers || {}
  next.http.services = next.http.services || {}

  next.http.routers[key] = {
    rule: rule(route.domains),
    service: key,
    ...(route.ssl ? { tls: {}, entryPoints: ['websecure'] } : { entryPoints: ['web'] }),
  }
  next.http.services[key] = {
    loadBalancer: {
      servers: [{ url: `${route.ssl ? 'http' : 'http'}://${route.upstreamHost}:${route.upstreamPort}` }],
    },
  }
  return next
}

/** Remove a homeport-<slug> router + service. Refuses non-homeport keys. */
export function removeRoute(doc: any, id: string): any {
  if (!id.startsWith(HP_PREFIX)) throw new Error('refusing to remove a non-homeport route')
  const next = doc ? structuredClone(doc) : {}
  if (next.http?.routers) delete next.http.routers[id]
  if (next.http?.services) delete next.http.services[id]
  return next
}

function hostsFromRule(r: string): string[] {
  const out: string[] = []
  for (const m of String(r || '').matchAll(/Host\(([^)]*)\)/g)) {
    for (const q of m[1].matchAll(/[`'"]([^`'"]+)[`'"]/g)) out.push(q[1])
  }
  return out
}

/** List every router as an AdminRoute (managed = homeport-prefixed). */
export function listRoutes(doc: any): AdminRoute[] {
  const routers: Record<string, any> = doc?.http?.routers || {}
  const services: Record<string, any> = doc?.http?.services || {}
  const out: AdminRoute[] = []
  for (const [key, r] of Object.entries<any>(routers)) {
    const domains = hostsFromRule(r?.rule)
    if (!domains.length) continue
    let ssl = !!r?.tls
    const eps = r?.entryPoints || r?.entrypoints
    if (Array.isArray(eps) && eps.some((e: string) => /websecure|https/i.test(String(e)))) ssl = true
    const svc = services[r?.service]
    const url: string = svc?.loadBalancer?.servers?.[0]?.url || svc?.loadbalancer?.servers?.[0]?.url || ''
    const m = url.match(/^https?:\/\/([^/\s]+)/)
    const [uhost, uport] = (m?.[1] || '').split(':')
    out.push({
      id: key,
      domains,
      upstreamHost: uhost || String(r?.service || ''),
      upstreamPort: Number(uport) || (ssl ? 443 : 80),
      ssl,
      managed: key.startsWith(HP_PREFIX),
    })
  }
  return out
}
