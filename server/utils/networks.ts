import type { HostConfig } from './hosts'
import { getDockerFor, oneShot } from './docker'
import { BUILTIN_NETWORKS, type NetworkInfo } from './networks-core'

// Docker network listing/removal — used by the stacks troubleshooting flow
// (compose "Pool overlaps" failures) and GET /api/networks. Needs NETWORKS=1
// on a socket proxy; removal additionally needs POST=1.

export async function listNetworksFor(host: HostConfig): Promise<NetworkInfo[]> {
  const docker = getDockerFor(host)
  const [nets, containers] = await Promise.all([
    docker.listNetworks(oneShot()),
    docker.listContainers({ all: true, ...oneShot() }),
  ])

  // track references per network name (stopped containers keep theirs — removing
  // such a network breaks the container's next start, so they count too)
  const refs = new Map<string, { id: string; name: string }[]>()
  for (const c of containers) {
    const entry = { id: `${host.id}::${c.Id}`, name: (c.Names?.[0] || '').replace(/^\//, '') }
    for (const name of Object.keys(c.NetworkSettings?.Networks || {})) {
      refs.set(name, [...(refs.get(name) || []), entry])
    }
  }

  return (nets || [])
    .map((n) => {
      const attached = refs.get(n.Name || '') || []
      return {
        id: n.Id || '',
        name: n.Name || '',
        driver: n.Driver || '',
        builtin: BUILTIN_NETWORKS.includes(n.Name || ''),
        subnets: (n.IPAM?.Config || []).map((c) => c.Subnet || '').filter(Boolean),
        containers: attached.length,
        attached,
        project: (n.Labels || {})['com.docker.compose.project'] || null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Remove a network by name — refuses builtins and networks still referenced. */
export async function removeNetworkFor(host: HostConfig, name: string): Promise<void> {
  const nets = await listNetworksFor(host)
  const net = nets.find((n) => n.name === name)
  if (!net) throw new Error(`no network named "${name}"`)
  if (net.builtin) throw new Error(`"${name}" is a built-in docker network`)
  if (net.containers > 0)
    throw new Error(`network "${name}" is still used by ${net.containers} container${net.containers > 1 ? 's' : ''}`)
  await getDockerFor(host).getNetwork(net.id).remove(oneShot())
}
