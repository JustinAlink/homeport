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
  /** how the proxy reaches the container: by container name (needs a shared network) or a host IP + published port */
  via?: 'name' | 'ip'
}

export interface Service {
  id: string
  kind: 'container' | 'systemd'
  host?: string // host name (set when watching multiple hosts)
  name: string // docker container name (or systemd unit)
  displayName: string // hub.name label > compose service > container name
  image: string
  state: string // running | exited | restarting | created | paused | dead
  statusText: string // raw docker status, e.g. "Up 3 days (healthy)"
  health: HealthState
  createdAt: number // unix ms
  ports: ServicePort[]
  internalPorts?: number[] // container-internal ports incl. exposed-but-unpublished (proxy-upstream hint)
  networks?: string[] // docker networks the container is attached to
  group: string // hub.group label > compose project > "Other"
  project: string | null
  composeService?: string | null // compose service name (com.docker.compose.service)
  icon: string | null // hub.icon label
  domains: ServiceDomain[]
  hidden: boolean // hub.hide label
  noalert: boolean // hub.noalert label — exclude from alerting
}

export interface ContainerStats {
  cpuPercent: number | null
  memBytes: number
  memLimitBytes: number
  memPercent: number | null
}

export type StatsMap = Record<string, ContainerStats>

export interface HostStats {
  ncpu: number
  cpuPercent: number // fleet CPU as a % of host cores
  memUsed: number
  memTotal: number // host total RAM (from docker info)
  memPercent: number
  /** Whole-host usage from procfs (containers + everything else). Absent for remote hosts. */
  system?: {
    cpuPercent: number
    memUsed: number // total − available: honest "in use", page cache excluded
    memTotal: number
    memPercent: number
  } | null
}

export interface StatsResponse {
  containers: StatsMap
  host: HostStats | null
}

export interface PingResult {
  status: number // HTTP status, or 0 = no response (down)
  ms: number
  /** 'proxy': the public address didn't answer from inside Docker, so this came straight from the reverse proxy */
  via?: 'proxy'
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
  remoteIcons: boolean // fetch real app logos from the CDN
  hosts: { id: string; name: string; online: boolean; error?: string | null }[]
  generatedAt: number
}
