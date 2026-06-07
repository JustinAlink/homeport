// A reverse-proxy "domain provider" turns proxy config into a list of routes
// (which domain points to which upstream host:port). NPM is the first impl;
// Traefik / Caddy can be added later behind the same interface.

export interface Route {
  domains: string[]
  upstreamHost: string // container name OR a host IP (e.g. 172.17.0.1)
  upstreamPort: number
  ssl: boolean
}

export interface DomainProvider {
  name: string
  getRoutes(): Promise<Route[]>
}
