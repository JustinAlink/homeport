// Where to reach the Docker API, parsed from DOCKER_HOST. Pure — unit-tested.
export interface DockerTarget {
  kind: 'ssh' | 'tcp' | 'socket'
  host?: string
  port?: number
  username?: string
}

/**
 *  ssh://user@host[:22]   → connect over SSH to the remote docker socket
 *  tcp://host[:2375]      → TCP (e.g. the bundled docker-socket-proxy)
 *  (empty / anything else)→ local unix socket
 */
export function parseDockerHost(dockerHost: string): DockerTarget {
  const h = (dockerHost || '').trim()
  if (h.startsWith('ssh://')) {
    const u = new URL(h)
    return {
      kind: 'ssh',
      host: u.hostname,
      port: u.port ? Number(u.port) : 22,
      username: u.username ? decodeURIComponent(u.username) : undefined,
    }
  }
  if (h.startsWith('tcp://') || h.startsWith('http://')) {
    const u = new URL(h.replace(/^tcp:\/\//, 'http://'))
    return { kind: 'tcp', host: u.hostname, port: u.port ? Number(u.port) : 2375 }
  }
  return { kind: 'socket' }
}
