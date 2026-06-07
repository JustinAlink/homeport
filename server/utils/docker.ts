import Docker from 'dockerode'
import type { HealthState, ServicePort } from '~/types/service'
import { getConfig } from './config'

let _docker: Docker | null = null

/** Lazily build a dockerode client from config (tcp socket-proxy or unix socket). */
export function getDocker(): Docker {
  if (_docker) return _docker
  const cfg = getConfig()
  if (cfg.dockerHost) {
    const url = new URL(cfg.dockerHost.replace(/^tcp:\/\//, 'http://'))
    _docker = new Docker({ host: url.hostname, port: Number(url.port) || 2375, protocol: 'http' })
  } else {
    _docker = new Docker({ socketPath: cfg.dockerSocket })
  }
  return _docker
}

export interface RawContainer {
  id: string
  name: string
  image: string
  state: string
  statusText: string
  health: HealthState
  createdAt: number
  ports: ServicePort[]
  project: string | null
  service: string | null
  labels: Record<string, string>
}

function parseHealth(status: string): HealthState {
  if (/\(healthy\)/i.test(status)) return 'healthy'
  if (/\(unhealthy\)/i.test(status)) return 'unhealthy'
  if (/health:\s*starting/i.test(status)) return 'starting'
  return null
}

function publishedPorts(ports: Docker.Port[] | undefined): ServicePort[] {
  const seen = new Set<string>()
  const out: ServicePort[] = []
  for (const p of ports || []) {
    if (!p.PublicPort) continue // only host-published ports
    const key = `${p.PublicPort}/${p.Type}`
    if (seen.has(key)) continue // dedupe IPv4 + IPv6 duplicates
    seen.add(key)
    out.push({ hostPort: p.PublicPort, containerPort: p.PrivatePort, type: p.Type })
  }
  return out.sort((a, b) => a.hostPort - b.hostPort)
}

function mapContainer(c: Docker.ContainerInfo): RawContainer {
  const name = (c.Names?.[0] || '').replace(/^\//, '')
  const labels = c.Labels || {}
  return {
    id: c.Id,
    name,
    image: c.Image,
    state: c.State,
    statusText: c.Status,
    health: parseHealth(c.Status),
    createdAt: c.Created * 1000,
    ports: publishedPorts(c.Ports),
    project: labels['com.docker.compose.project'] || null,
    service: labels['com.docker.compose.service'] || null,
    labels,
  }
}

export async function listContainers(): Promise<RawContainer[]> {
  const list = await getDocker().listContainers({ all: true })
  return list.map(mapContainer)
}

/** Returns a readable stream of Docker container events (start/stop/die/health…). */
export async function getEventStream(): Promise<NodeJS.ReadableStream> {
  return (await getDocker().getEvents({
    filters: { type: ['container'] },
  })) as unknown as NodeJS.ReadableStream
}
