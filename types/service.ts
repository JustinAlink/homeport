// Shared types between the Nitro server and the Vue client.

export type HealthState = 'healthy' | 'unhealthy' | 'starting' | null

export interface ServicePort {
  hostPort: number
  containerPort: number
  type: string // tcp | udp
}

export interface ServiceDomain {
  domain: string
  url: string
  ssl: boolean
}

export interface Service {
  id: string
  kind: 'container' | 'systemd'
  name: string // docker container name (or systemd unit)
  displayName: string // hub.name label > compose service > container name
  image: string
  state: string // running | exited | restarting | created | paused | dead
  statusText: string // raw docker status, e.g. "Up 3 days (healthy)"
  health: HealthState
  createdAt: number // unix ms
  ports: ServicePort[]
  group: string // hub.group label > compose project > "Other"
  project: string | null
  icon: string | null // hub.icon label
  domains: ServiceDomain[]
  hidden: boolean // hub.hide label
}

export interface ContainerStats {
  cpuPercent: number | null
  memBytes: number
  memLimitBytes: number
  memPercent: number | null
}

export type StatsMap = Record<string, ContainerStats>

export interface PingResult {
  status: number // HTTP status, or 0 = no response (down)
  ms: number
}
export type PingMap = Record<string, PingResult>

export interface UnmatchedRoute {
  domains: string[]
  upstream: string // host:port
  ssl: boolean
}

export interface ServicesResponse {
  services: Service[]
  unmatched: UnmatchedRoute[]
  stats: { running: number; total: number; groups: number }
  domainProvider: string | null // e.g. "Nginx Proxy Manager"
  controlEnabled: boolean // start/stop controls available?
  generatedAt: number
}
