import { readFileSync } from 'node:fs'
import Docker from 'dockerode'
import type { HealthState, ServicePort } from '~/types/service'
import { getConfig } from './config'
import { parseDockerHost } from './docker-target'

let _docker: Docker | null = null

/** Lazily build a dockerode client from config (ssh / tcp socket-proxy / unix socket). */
export function getDocker(): Docker {
  if (_docker) return _docker
  const cfg = getConfig()
  const target = parseDockerHost(cfg.dockerHost)

  if (target.kind === 'ssh') {
    const sshOptions = cfg.dockerSshKey
      ? { privateKey: readFileSync(cfg.dockerSshKey), passphrase: cfg.dockerSshPassphrase || undefined }
      : { agent: process.env.SSH_AUTH_SOCK }
    _docker = new Docker({
      protocol: 'ssh',
      host: target.host,
      port: target.port,
      username: target.username,
      sshOptions,
    } as Docker.DockerOptions)
  } else if (target.kind === 'tcp') {
    _docker = new Docker({ host: target.host, port: target.port, protocol: 'http' })
  } else {
    _docker = new Docker({ socketPath: cfg.dockerSocket })
  }
  return _docker
}

/** Drop the cached client so the next call reconnects (after a settings change). */
export function resetDocker(): void {
  _docker = null
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

/** Start or stop a container by id (control mode only). */
export async function controlContainer(id: string, action: 'start' | 'stop'): Promise<void> {
  const container = getDocker().getContainer(id)
  if (action === 'start') await container.start()
  else await container.stop()
}

/** Returns a readable stream of Docker container events (start/stop/die/health…). */
export async function getEventStream(): Promise<NodeJS.ReadableStream> {
  return (await getDocker().getEvents({
    filters: { type: ['container'] },
  })) as unknown as NodeJS.ReadableStream
}
