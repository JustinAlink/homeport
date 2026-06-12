import type { AdminRoute, NewRoute } from './types'

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
