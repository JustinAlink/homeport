import type { AdminRoute, NewRoute, ProxyAccess } from './types'

// Pure builders/mappers for the Nginx Proxy Manager REST API. No I/O.

export interface NpmProxyHost {
  id: number
  domain_names: string[]
  forward_scheme: string
  forward_host: string
  forward_port: number
  certificate_id: number | string
  ssl_forced: boolean
  enabled: number | boolean
}

/**
 * Build a proxy-host create/update body. SSL in v2 reuses an existing certificate
 * whose domains cover the request (certId passed in by the caller); we don't
 * provision new certs — that stays in NPM's own UI.
 */
export function buildProxyHostPayload(route: NewRoute, certId = 0): Record<string, any> {
  const useCert = route.ssl && certId > 0
  return {
    domain_names: route.domains,
    forward_scheme: 'http',
    forward_host: route.upstreamHost,
    forward_port: route.upstreamPort,
    certificate_id: useCert ? certId : 0,
    ssl_forced: useCert,
    http2_support: useCert,
    block_exploits: true,
    allow_websocket_upgrade: true,
    caching_enabled: false,
    access_list_id: 0,
    advanced_config: '',
    enabled: true,
    locations: [],
    meta: { homeport: true },
  }
}

export function npmRouteFrom(h: NpmProxyHost): AdminRoute {
  return {
    id: String(h.id),
    domains: h.domain_names || [],
    upstreamHost: h.forward_host,
    upstreamPort: Number(h.forward_port),
    ssl: !!h.ssl_forced || (typeof h.certificate_id === 'number' ? h.certificate_id > 0 : !!h.certificate_id),
    managed: true, // NPM is a management API — homeport can edit any proxy host
  }
}

/**
 * Choose a certificate that covers all of the route's domains (exact match or a
 * matching wildcard). Returns the cert id, or 0 if none fit.
 */
export function pickCertificate(
  domains: string[],
  certs: { id: number; domain_names: string[] }[],
): number {
  const covers = (certDomains: string[], domain: string) =>
    certDomains.some((cd) => cd === domain || (cd.startsWith('*.') && domain.endsWith(cd.slice(1))))
  for (const c of certs) {
    if (domains.every((d) => covers(c.domain_names || [], d))) return c.id
  }
  return 0
}

/**
 * NPM users have per-type permissions, and a new user gets NPM's defaults:
 * "own items only" visibility, so it sees none of the hosts other accounts made.
 * homeport logged in fine with such a user and silently listed nothing (seen live
 * 2026-10-24). This reads `GET /api/users/me?expand=permissions` (snake_case from
 * the API, camelCase in NPM's own frontend: both accepted) and says what is missing.
 */
export function npmAccessFrom(me: any): ProxyAccess {
  const perms = me?.permissions ?? {}
  const pick = (snake: string, camel: string) => String(perms[snake] ?? perms[camel] ?? '')
  const admin = Array.isArray(me?.roles) && me.roles.includes('admin')
  const visibility = pick('visibility', 'visibility')
  const proxyHosts = pick('proxy_hosts', 'proxyHosts')
  const issues: ProxyAccess['issues'] = []
  if (admin) {
    issues.push({
      level: 'info',
      text: 'homeport signs in to NPM with an administrator account. A dedicated NPM user with only Proxy Hosts: Manage (and Item visibility: All items) limits what a leaked homeport login could do.',
    })
  } else {
    if (visibility === 'user') {
      issues.push({
        level: 'warn',
        text: "This NPM user only sees proxy hosts it created itself, so hosts made in NPM or by another account are missing here. In NPM: Users, the user's ⋮ menu, Permissions, Item visibility: All items.",
      })
    }
    if (proxyHosts === 'view') {
      issues.push({ level: 'warn', text: 'This NPM user can see proxy hosts but not change them, so adding, editing and removing domains is off. Give it Proxy Hosts: Manage.' })
    } else if (proxyHosts === 'hidden') {
      issues.push({ level: 'warn', text: "This NPM user can't see proxy hosts at all. Give it Proxy Hosts: Manage." })
    }
  }
  return { identity: String(me?.email ?? ''), admin, canManage: admin || proxyHosts === 'manage', issues }
}
