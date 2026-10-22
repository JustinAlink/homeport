import { httpJson } from '../http'
import { log } from '../log'
import type { ProxyAdmin, AdminRoute, NewRoute } from './types'
import { buildProxyHostPayload, npmRouteFrom, pickCertificate, type NpmProxyHost } from './npm-admin-core'
import { npmLoginError } from './npm-bootstrap-core'

// Nginx Proxy Manager REST API. Auth: POST /api/tokens {identity,secret} → JWT,
// cached and refreshed on 401. CRUD on /api/nginx/proxy-hosts.

export interface NpmAdminConfig {
  url: string // e.g. http://npm:81
  identity: string
  secret: string
}

const tokenCache = new Map<string, { token: string; at: number }>()
const TOKEN_TTL = 50 * 60 * 1000

export function createNpmAdmin(cfg: NpmAdminConfig): ProxyAdmin {
  const base = cfg.url.replace(/\/$/, '')
  const cacheKey = `${base}|${cfg.identity}`

  async function login(): Promise<string> {
    const r = await httpJson<{ token: string }>(`${base}/api/tokens`, {
      method: 'POST',
      body: JSON.stringify({ identity: cfg.identity, secret: cfg.secret }),
    })
    if (!r.ok || !r.data?.token) throw new Error(npmLoginError(r))
    tokenCache.set(cacheKey, { token: r.data.token, at: Date.now() })
    return r.data.token
  }

  async function token(): Promise<string> {
    const c = tokenCache.get(cacheKey)
    if (c && Date.now() - c.at < TOKEN_TTL) return c.token
    return login()
  }

  async function api<T = any>(path: string, opts: { method?: string; body?: string } = {}, retry = true): Promise<T> {
    const t = await token()
    const r = await httpJson<T>(`${base}${path}`, { ...opts, headers: { authorization: `Bearer ${t}` } })
    if (r.status === 401 && retry) {
      tokenCache.delete(cacheKey)
      return api<T>(path, opts, false)
    }
    if (!r.ok) throw new Error(`NPM ${opts.method || 'GET'} ${path} failed (${r.error || r.status})`)
    return r.data as T
  }

  async function certIdFor(route: NewRoute): Promise<number> {
    if (!route.ssl) return 0
    try {
      const certs = await api<{ id: number; domain_names: string[] }[]>('/api/nginx/certificates')
      const id = pickCertificate(route.domains, certs || [])
      // SSL was requested but no matching cert exists — the route would be created
      // WITHOUT TLS. Surface it rather than silently downgrading.
      if (!id) log.warn('proxy-admin', `NPM has no certificate matching ${route.domains.join(', ')} — creating the route without SSL`)
      return id
    } catch (e) {
      log.warn('proxy-admin', `NPM certificate lookup failed for ${route.domains.join(', ')} — creating the route without SSL`, e)
      return 0
    }
  }

  return {
    name: 'Nginx Proxy Manager',
    capabilities: { create: true, update: true, delete: true },

    async test() {
      try {
        await api('/api/nginx/proxy-hosts')
        return { ok: true, message: 'Connected to Nginx Proxy Manager.' }
      } catch (e: any) {
        return { ok: false, message: e?.message || 'connection failed' }
      }
    },

    async listRoutes(): Promise<AdminRoute[]> {
      const hosts = await api<NpmProxyHost[]>('/api/nginx/proxy-hosts')
      return (hosts || []).map(npmRouteFrom)
    },

    async createRoute(route: NewRoute): Promise<AdminRoute> {
      const payload = buildProxyHostPayload(route, await certIdFor(route))
      const created = await api<NpmProxyHost>('/api/nginx/proxy-hosts', { method: 'POST', body: JSON.stringify(payload) })
      return npmRouteFrom(created)
    },

    async updateRoute(id: string, route: NewRoute): Promise<AdminRoute> {
      const payload = buildProxyHostPayload(route, await certIdFor(route))
      const updated = await api<NpmProxyHost>(`/api/nginx/proxy-hosts/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      return npmRouteFrom(updated)
    },

    async deleteRoute(id: string): Promise<void> {
      await api(`/api/nginx/proxy-hosts/${id}`, { method: 'DELETE' })
    },
  }
}
