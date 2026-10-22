// Pure helpers for the domain check's fallback route (ping.ts). Many servers can't
// reach their OWN public address from inside Docker: no NAT loopback on a home
// router, or a firewall that drops a container's traffic to the host's public IP
// (Docker only forwards published ports for traffic from outside the proxy's own
// network). Then every domain looks down although it works. The fallback asks the
// reverse proxy container directly, by container name, with the domain as Host
// header and TLS server name: the same proxy route and app, minus the public hop.

import { parseImageRef } from './registry-core.ts'

// Kept in step with composables/useProxyReach.ts (the client finds the proxy the same way).
export const PROXY_IMAGES = [
  'jc21/nginx-proxy-manager',
  'traefik',
  'caddy',
  'lucaslorentz/caddy-docker-proxy',
  'nginxproxy/nginx-proxy',
  'jwilder/nginx-proxy',
]

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

/** Which route to try first: straight to the proxy while the public one is known to fail. */
export function routeOrder(publicDownUntil: number | undefined, now: number, hasProxy: boolean): ('public' | 'proxy')[] {
  if (!hasProxy) return ['public']
  return publicDownUntil && publicDownUntil > now ? ['proxy', 'public'] : ['public', 'proxy']
}
