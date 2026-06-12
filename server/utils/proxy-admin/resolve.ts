import { getConfig } from '../config'
import { getHosts } from '../hosts'
import { getProxyAdminFor } from './index'
import type { ProxyAdmin, NewRoute } from './types'

/** Resolve the proxy admin for a request; throws tagged errors the endpoints map to HTTP. */
export function resolveAdmin(hostId?: string): ProxyAdmin {
  const cfg = getConfig()
  if (!cfg.allowProxyAdmin && !cfg.demo) {
    throw Object.assign(new Error('Proxy admin is disabled (HOMEPORT_ALLOW_PROXY_ADMIN=true to enable).'), { code: 403 })
  }
  const host = hostId ? getHosts().find((h) => h.id === hostId) : getHosts()[0]
  if (!host) throw Object.assign(new Error('Unknown host'), { code: 404 })
  const admin = getProxyAdminFor(host)
  if (!admin) throw Object.assign(new Error('No proxy admin configured for this host (set its API credentials in Settings).'), { code: 400 })
  return admin
}

/** Validate + normalize a route body. */
export function parseRouteBody(body: any): NewRoute {
  const domains = Array.isArray(body?.domains) ? body.domains.map((d: any) => String(d).trim().toLowerCase()).filter(Boolean) : []
  const upstreamHost = String(body?.upstreamHost || '').trim()
  const upstreamPort = Number(body?.upstreamPort)
  if (!domains.length) throw Object.assign(new Error('at least one domain is required'), { code: 400 })
  if (!upstreamHost) throw Object.assign(new Error('upstreamHost is required'), { code: 400 })
  if (!Number.isFinite(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw Object.assign(new Error('upstreamPort must be 1–65535'), { code: 400 })
  }
  return { domains, upstreamHost, upstreamPort, ssl: !!body?.ssl }
}
