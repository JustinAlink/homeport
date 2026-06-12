import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import Docker from 'dockerode'
import type { HealthState, ServicePort } from '~/types/service'
import type { HostConfig } from './hosts'
import { parseDockerHost } from './docker-target'

const clients = new Map<string, Docker>()

/** Lazily build (and cache) a dockerode client for a host (ssh / tcp / unix socket). */
export function getDockerFor(host: HostConfig): Docker {
  const cached = clients.get(host.id)
  if (cached) return cached

  const target = parseDockerHost(host.dockerHost)
  let docker: Docker
  if (target.kind === 'ssh') {
    const sshOptions: any = host.dockerSshKey
      ? { privateKey: readFileSync(host.dockerSshKey), passphrase: process.env.DOCKER_SSH_KEY_PASSPHRASE || undefined }
      : { agent: process.env.SSH_AUTH_SOCK }
    // Optional host-key verification: compare the remote key's SHA256 to the expected.
    if (host.sshFingerprint) {
      const want = host.sshFingerprint.replace(/^SHA256:/i, '').replace(/=+$/, '')
      sshOptions.hostVerifier = (key: Buffer) =>
        createHash('sha256').update(key).digest('base64').replace(/=+$/, '') === want
    }
    docker = new Docker({ protocol: 'ssh', host: target.host, port: target.port, username: target.username, sshOptions } as Docker.DockerOptions)
  } else if (target.kind === 'tcp') {
    docker = new Docker({ host: target.host, port: target.port, protocol: 'http' })
  } else {
    docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' })
  }
  clients.set(host.id, docker)
  return docker
}

/** Drop cached clients so the next call reconnects (after a settings change). */
export function resetDocker(): void {
  clients.clear()
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
    if (!p.PublicPort) continue
    const key = `${p.PublicPort}/${p.Type}`
    if (seen.has(key)) continue
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

export async function listContainersFor(host: HostConfig): Promise<RawContainer[]> {
  const list = await getDockerFor(host).listContainers({ all: true })
  return list.map(mapContainer)
}

export async function controlContainerFor(host: HostConfig, id: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
  const container = getDockerFor(host).getContainer(id)
  if (action === 'start') await container.start()
  else if (action === 'restart') await container.restart()
  else await container.stop()
}

export async function getEventStreamFor(host: HostConfig): Promise<NodeJS.ReadableStream> {
  return (await getDockerFor(host).getEvents({ filters: { type: ['container'] } })) as unknown as NodeJS.ReadableStream
}
