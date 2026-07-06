import type { HostConfig } from './hosts'
import { getDockerFor, oneShot } from './docker'
import { BUILTIN_NETWORKS, parseCidr, findSubnetConflicts, safeNetworkName, type NetworkInfo } from './networks-core'

// Docker network listing/removal/creation and container attach/detach — used
// by the /networks page and the stacks troubleshooting flow (compose "Pool
// overlaps" failures). Needs NETWORKS=1 on a socket proxy; anything that
// changes state additionally needs POST=1.

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

/**
 * Create a bridge network, optionally with a fixed subnet. The subnet is
 * checked against existing networks first so the failure is a named conflict,
 * not the daemon's bare "Pool overlaps".
 */
export async function createNetworkFor(host: HostConfig, input: { name: string; subnet?: string }): Promise<void> {
  const name = safeNetworkName(input.name)
  if (!name) throw new Error('invalid network name (letters, digits, . _ -)')
  const subnet = String(input.subnet || '').trim()
  if (subnet && !parseCidr(subnet)) throw new Error(`"${subnet}" is not a valid CIDR subnet (e.g. 172.30.0.0/16)`)

  const existing = await listNetworksFor(host)
  if (existing.some((n) => n.name === name)) throw new Error(`a network named "${name}" already exists`)
  if (subnet) {
    const clash = findSubnetConflicts([subnet], existing)[0]
    if (clash) throw new Error(`subnet ${subnet} overlaps existing network "${clash.network}" (${clash.subnet})`)
  }

  await getDockerFor(host).createNetwork({
    Name: name,
    Driver: 'bridge',
    ...(subnet ? { IPAM: { Driver: 'default', Config: [{ Subnet: subnet }] } } : {}),
  })
}

/** Attach a container to a network (runtime — compose re-ups reset to the file). */
export async function connectContainerFor(host: HostConfig, network: string, containerId: string): Promise<void> {
  const net = (await listNetworksFor(host)).find((n) => n.name === network)
  if (!net) throw new Error(`no network named "${network}"`)
  await getDockerFor(host).getNetwork(net.id).connect({ Container: containerId })
}

/** Detach a container from a network. Refuses removing its LAST network. */
export async function disconnectContainerFor(host: HostConfig, network: string, containerId: string): Promise<void> {
  const nets = await listNetworksFor(host)
  const net = nets.find((n) => n.name === network)
  if (!net) throw new Error(`no network named "${network}"`)
  const memberships = nets.filter((n) => n.attached?.some((c) => c.id.endsWith(`::${containerId}`) || c.id === containerId))
  if (memberships.length <= 1) {
    throw new Error('that is the container\'s only network — attach it to another one first (a container with no network is unreachable)')
  }
  await getDockerFor(host).getNetwork(net.id).disconnect({ Container: containerId, Force: false })
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
