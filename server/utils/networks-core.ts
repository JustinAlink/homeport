// Pure, dependency-free docker-network logic — unit-testable in isolation.
// Used to explain compose "Pool overlaps" / pool-exhaustion failures.

export const BUILTIN_NETWORKS = ['bridge', 'host', 'none']

export interface NetworkInfo {
  id: string
  name: string
  driver: string
  builtin: boolean
  subnets: string[]
  /** Containers referencing the network (running or not). */
  containers: number
  /** The attached containers themselves (service ids for linking). */
  attached?: { id: string; name: string }[]
  /** com.docker.compose.project label, when compose created the network. */
  project?: string | null
}

/** Leftover networks of a compose project — its label or name prefix, unused. */
export function leftoverProjectNetworks(networks: NetworkInfo[], project: string): NetworkInfo[] {
  return networks.filter(
    (n) => !n.builtin && n.containers === 0 && (n.project === project || n.name.startsWith(`${project}_`)),
  )
}

/** Parse an IPv4 or IPv6 CIDR into a numeric range. Returns null on garbage. */
export function parseCidr(cidr: string): { start: bigint; end: bigint; v6: boolean } | null {
  const m = /^([^/\s]+)\/(\d{1,3})$/.exec(String(cidr || '').trim())
  if (!m) return null
  const [, addr, prefixStr] = m
  const prefix = Number(prefixStr)

  if (addr.includes(':')) {
    if (prefix > 128) return null
    const ip = parseIpv6(addr)
    if (ip === null) return null
    const host = 128n - BigInt(prefix)
    const start = (ip >> host) << host
    return { start, end: start + (1n << host) - 1n, v6: true }
  }

  if (prefix > 32) return null
  const parts = addr.split('.')
  if (parts.length !== 4) return null
  let ip = 0n
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null
    ip = (ip << 8n) + BigInt(Number(p))
  }
  const host = 32n - BigInt(prefix)
  const start = (ip >> host) << host
  return { start, end: start + (1n << host) - 1n, v6: false }
}

function parseIpv6(addr: string): bigint | null {
  const halves = addr.split('::')
  if (halves.length > 2) return null
  const expand = (s: string) => (s ? s.split(':') : [])
  const head = expand(halves[0])
  const tail = halves.length === 2 ? expand(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  let ip = 0n
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
    ip = (ip << 16n) + BigInt(parseInt(g, 16))
  }
  return ip
}

export function cidrsOverlap(a: string, b: string): boolean {
  const ra = parseCidr(a)
  const rb = parseCidr(b)
  if (!ra || !rb || ra.v6 !== rb.v6) return false
  return ra.start <= rb.end && rb.start <= ra.end
}

export interface SubnetConflict {
  requested: string
  network: string
  subnet: string
  containers: number
}

/** Which existing networks overlap the subnets a stack asks for. */
export function findSubnetConflicts(requested: string[], networks: NetworkInfo[]): SubnetConflict[] {
  const out: SubnetConflict[] = []
  for (const req of requested) {
    for (const n of networks) {
      for (const sub of n.subnets) {
        if (cidrsOverlap(req, sub)) out.push({ requested: req, network: n.name, subnet: sub, containers: n.containers })
      }
    }
  }
  return out
}

/** Classify a failed compose run's output as a docker-network address problem. */
export function detectNetworkError(output: string): 'overlap' | 'exhausted' | null {
  if (/pool overlaps with other one on this address space/i.test(output)) return 'overlap'
  if (/(could not find an available, non-overlapping|all predefined address pools have been fully subnetted)/i.test(output))
    return 'exhausted'
  return null
}

/** Subnets requested by a stack, from `docker compose config --format json` output. */
export function subnetsFromComposeConfig(cfg: unknown): string[] {
  const out: string[] = []
  const networks = (cfg as { networks?: Record<string, unknown> })?.networks
  if (!networks || typeof networks !== 'object') return out
  for (const net of Object.values(networks)) {
    const configs = (net as { ipam?: { config?: { subnet?: unknown }[] } })?.ipam?.config
    if (!Array.isArray(configs)) continue
    for (const c of configs) {
      if (typeof c?.subnet === 'string' && c.subnet) out.push(c.subnet)
    }
  }
  return out
}
