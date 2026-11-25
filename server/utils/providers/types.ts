// A reverse-proxy "domain provider" turns proxy config into a list of routes
// (which domain points to which upstream host:port). Config-file and API readers
// implement DomainProvider; label readers (Traefik, caddy-docker-proxy, Pangolin)
// are pure functions over the container list, see providers/index.ts.

export interface Route {
  domains: string[]
  upstreamHost: string // container name, a container's own IP, or a host IP (e.g. 172.17.0.1)
  upstreamPort: number // 0 = not stated (a label without a port and nothing exposed)
  ssl: boolean
  /** which source this came from (e.g. "Traefik (API)"), shown next to the domain */
  source?: string
}

export interface DomainProvider {
  name: string
  getRoutes(): Promise<Route[]>
}
