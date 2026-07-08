import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import Docker from 'dockerode'
import type { HealthState, ServicePort } from '~/types/service'
import type { HostConfig } from './hosts'
import { parseDockerHost } from './docker-target'

const clients = new Map<string, Docker>()

/**
 * A hard deadline for one-shot Docker calls. Without it a half-open TCP connection
 * to the daemon (common with a socket-proxy mid-restart) hangs the request forever —
 * this was the dashboard's "stuck on Loading…". Long-lived streams (events,
 * logs --follow, exec, stats --stream) pass no signal, so they stay open.
 * Override with HOMEPORT_DOCKER_TIMEOUT_MS. (Don't use docker-modem's own
 * DOCKER_CLIENT_TIMEOUT — it arms a socket timeout on every request, killing streams.)
 */
const ONESHOT_TIMEOUT = Number(process.env.HOMEPORT_DOCKER_TIMEOUT_MS) || 15000
export const oneShot = () => ({ abortSignal: AbortSignal.timeout(ONESHOT_TIMEOUT) })

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
  internalPorts: number[] // container-internal ports (incl. exposed-but-unpublished)
  project: string | null
  service: string | null
  networks: string[]
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

// Every distinct container-internal port, including ones only EXPOSEd (not host-published).
// That's what a reverse proxy targeting the container name on a shared network connects to.
function internalPorts(ports: Docker.Port[] | undefined): number[] {
  const seen = new Set<number>()
  for (const p of ports || []) {
    if (p.PrivatePort) seen.add(p.PrivatePort)
  }
  return [...seen].sort((a, b) => a - b)
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
    internalPorts: internalPorts(c.Ports),
    project: labels['com.docker.compose.project'] || null,
    service: labels['com.docker.compose.service'] || null,
    networks: Object.keys(c.NetworkSettings?.Networks || {}),
    labels,
  }
}

export async function listContainersFor(host: HostConfig): Promise<RawContainer[]> {
  const list = await getDockerFor(host).listContainers({ all: true, ...oneShot() })
  return list.map(mapContainer)
}

export async function controlContainerFor(
  host: HostConfig,
  id: string,
  action: 'start' | 'stop' | 'restart' | 'remove',
  opts?: { volumes?: boolean },
): Promise<void> {
  const container = getDockerFor(host).getContainer(id)
  if (action === 'start') await container.start()
  else if (action === 'restart') await container.restart()
  else if (action === 'remove') await container.remove({ force: true, v: !!opts?.volumes })
  else await container.stop()
}

export async function getEventStreamFor(host: HostConfig): Promise<NodeJS.ReadableStream> {
  return (await getDockerFor(host).getEvents({ filters: { type: ['container'] } })) as unknown as NodeJS.ReadableStream
}
