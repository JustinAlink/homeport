import { httpJson } from '../http'
import type { ProxyAdmin, AdminRoute, NewRoute } from './types'
import { routeSlug } from './types'
import { buildCaddyRoute, caddyRoutesFromConfig, findHttpsServer, HP_PREFIX } from './caddy-admin-core'

// Caddy admin API (default http://localhost:2019). homeport-created routes carry
// @id="homeport-<slug>" so update/delete address /id/<@id>; user routes are
// listed read-only. The admin endpoint is root-of-proxy — keep it on a private
// network, never published (documented in the README).

export function createCaddyAdmin(adminUrl: string): ProxyAdmin {
  const base = adminUrl.replace(/\/$/, '')

  async function getConfig(): Promise<any> {
    const r = await httpJson(`${base}/config/`)
    if (!r.ok) throw new Error(`Caddy admin GET /config failed (${r.error || r.status})`)
    return r.data || {}
  }

  function ensureManaged(id: string) {
    if (!id.startsWith(HP_PREFIX)) throw new Error('only homeport-created Caddy routes can be modified here')
  }

  return {
    name: 'Caddy',
    capabilities: { create: true, update: true, delete: true },

    async test() {
      const r = await httpJson(`${base}/config/`)
      return r.ok
        ? { ok: true, message: 'Connected to the Caddy admin API.' }
        : { ok: false, message: `could not reach ${base} (${r.error || r.status})` }
    },

    async listRoutes(): Promise<AdminRoute[]> {
      return caddyRoutesFromConfig(await getConfig())
    },

    async createRoute(route: NewRoute): Promise<AdminRoute> {
      const config = await getConfig()
      const server = findHttpsServer(config)
      if (!server) throw new Error('no HTTP server found in the Caddy config')
      const obj = buildCaddyRoute(route, routeSlug(route))
      const r = await httpJson(`${base}/config/apps/http/servers/${server}/routes`, {
        method: 'POST',
        body: JSON.stringify(obj),
      })
      if (!r.ok) throw new Error(`Caddy create route failed (${r.error || r.status})`)
      return { ...route, id: obj['@id'], managed: true }
    },

    async updateRoute(id: string, route: NewRoute): Promise<AdminRoute> {
      ensureManaged(id)
      const slug = id.slice(HP_PREFIX.length)
      const obj = buildCaddyRoute(route, slug)
      const r = await httpJson(`${base}/id/${id}`, { method: 'PATCH', body: JSON.stringify(obj) })
      if (!r.ok) throw new Error(`Caddy update route failed (${r.error || r.status})`)
      return { ...route, id, managed: true }
    },

    async deleteRoute(id: string): Promise<void> {
      ensureManaged(id)
      const r = await httpJson(`${base}/id/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`Caddy delete route failed (${r.error || r.status})`)
    },
  }
}
