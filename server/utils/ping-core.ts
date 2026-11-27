// Pure helpers for the domain check's fallback route (ping.ts). Many servers can't
// reach their OWN public address from inside Docker: no NAT loopback on a home
// router, or a firewall that drops a container's traffic to the host's public IP
// (Docker only forwards published ports for traffic from outside the proxy's own
// network). Then every domain looks down although it works. The fallback asks the
// reverse proxy container directly, by container name, with the domain as Host
// header and TLS server name: the same proxy route and app, minus the public hop.

import { parseImageRef } from './registry-core.ts'

import { PROXY_IMAGES, SOURCE_PROXY_IMAGES, TUNNEL_SOURCES } from '../../shared/utils/proxy-sources.ts'

export { PROXY_IMAGES }

/** `traefik:v3.1` → `traefik`, `docker.io/jc21/nginx-proxy-manager` → `jc21/nginx-proxy-manager` */
export function imageRepoOf(image: string): string {
  return parseImageRef(image).repo.replace(/^library\//, '')
}

/** The running reverse-proxy container on the local host, by name, or null. */
export function findProxyName(services: { name: string; image: string; state: string; kind?: string; host?: string }[], localHost?: string): string | null {
  const proxy = services.find(
    (s) => (s.kind ?? 'container') === 'container' && s.state === 'running' && (!s.host || !localHost || s.host === localHost) && PROXY_IMAGES.includes(imageRepoOf(s.image)),
  )
  return proxy?.name ?? null
}

/**
 * Domains served from homeport's own host (the first one). Only these may fall back
 * to its proxy container: another host's domain sent through this host's proxy gets
 * this proxy's "no such host" page, and a Traefik 404 reads as "up", so an outage on
 * a remote host never showed and never alerted.
 */
export function localDomainUrls(services: { host?: string; domains: { url: string }[] }[], localHost?: string): Set<string> {
  const out = new Set<string>()
  for (const s of services) {
    if (s.host && localHost && s.host !== localHost) continue
    for (const d of s.domains) out.add(d.url)
  }
  return out
}

// The fallback proxy for a domain follows where homeport read it (see
// shared/utils/proxy-sources.ts). Sources not listed (plain nginx configs,
// unknown) keep the old guess: the first proxy found on the host.

type ProxyService = { name: string; image: string; state: string; kind?: string; host?: string; domains: { url: string; source?: string }[] }

/**
 * The fallback proxy container for each domain on homeport's own host (URL to
 * container name, null for none). Domains on other hosts are left out: another
 * host's domain sent through this host's proxy only gets its "no such host" page.
 */
export function proxyForDomains(services: ProxyService[], localHost?: string): Map<string, string | null> {
  const onLocal = (s: { host?: string }) => !s.host || !localHost || s.host === localHost
  const running = services.filter((s) => (s.kind ?? 'container') === 'container' && s.state === 'running' && onLocal(s))
  const byImage = (repos: string[]) => running.find((s) => repos.includes(imageRepoOf(s.image)))?.name ?? null
  const guess = findProxyName(services, localHost)
  const out = new Map<string, string | null>()
  for (const s of services) {
    if (!onLocal(s)) continue
    for (const d of s.domains) {
      const proxy = !d.source || !Object.hasOwn(SOURCE_PROXY_IMAGES, d.source) ? guess : TUNNEL_SOURCES.includes(d.source) ? null : byImage(SOURCE_PROXY_IMAGES[d.source])
      if (!out.has(d.url) || (out.get(d.url) == null && proxy)) out.set(d.url, proxy)
    }
  }
  return out
}

/** Which route to try first: straight to the proxy while the public one is known to fail. */
export function routeOrder(publicDownUntil: number | undefined, now: number, hasProxy: boolean): ('public' | 'proxy')[] {
  if (!hasProxy) return ['public']
  return publicDownUntil && publicDownUntil > now ? ['proxy', 'public'] : ['public', 'proxy']
}
