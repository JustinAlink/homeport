import type { Route } from '../providers/types'

// Write-side counterpart to DomainProvider: create/edit/remove the routes a
// reverse proxy serves. Each impl exposes its capabilities (some proxies are
// only partially manageable). `managed` marks routes homeport itself created —
// for Caddy/Traefik only those are editable/deletable; NPM manages all.

export interface AdminRoute extends Route {
  id: string // provider-native id (NPM numeric string, Caddy @id, Traefik router key)
  managed: boolean
}

export interface NewRoute {
  domains: string[]
  upstreamHost: string
  upstreamPort: number
  ssl: boolean
}

export interface ProxyAdmin {
  name: string
  capabilities: { create: boolean; update: boolean; delete: boolean }
  test(): Promise<{ ok: boolean; message: string }>
  listRoutes(): Promise<AdminRoute[]>
  createRoute(r: NewRoute): Promise<AdminRoute>
  updateRoute(id: string, r: NewRoute): Promise<AdminRoute>
  deleteRoute(id: string): Promise<void>
}

/** Slug used to namespace homeport-created routes (Caddy @id, Traefik router key). */
export function routeSlug(r: NewRoute): string {
  const base = (r.domains[0] || r.upstreamHost || 'route').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return base || 'route'
}
