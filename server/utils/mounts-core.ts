// Pure mount-classification for the stack "Data & mounts" view. No fs/docker —
// unit-testable. Turns raw container mounts into rows that answer "where does an
// installed app actually keep its files?": editable config inside the stack
// folder, named volumes, or host binds pointing elsewhere. This is what makes a
// searxng-style install (config lives in a named volume, not the compose file)
// discoverable instead of "only the compose file shows up".

export interface RawMount {
  type: string // 'bind' | 'volume' | 'tmpfs' | ...
  name?: string // volume name (type === 'volume')
  source?: string // host path (type === 'bind')
  destination: string // path inside the container
  rw: boolean
}

// `container` = a service id (host::containerId) of one container that has this
// mount, so the client can open the in-container file editor rooted at `dest`.
export type StackMount =
  | { kind: 'volume'; name: string; anonymous: boolean; dest: string; rw: boolean; services: string[]; container: string }
  | { kind: 'bind-internal'; rel: string; dest: string; rw: boolean; services: string[]; container: string }
  | { kind: 'bind-external'; source: string; dest: string; rw: boolean; services: string[]; container: string }

// Docker names anonymous volumes with a 64-char hex id — worth flagging, they
// aren't something a user chose or can easily map back to the app.
const isAnonVolume = (name: string) => /^[0-9a-f]{64}$/i.test(name)

const stripTrailingSlashes = (p: string) => p.replace(/\/+$/, '')

/**
 * One raw mount → a classified row, or null for things not worth showing
 * (tmpfs, destination-less, unnamed volumes). A bind whose source is inside the
 * stack directory is "internal" (editable in the file browser); anything else on
 * the host is "external". When stackDir is empty (dir path unknown to homeport)
 * every bind is treated as external.
 */
export function classifyMount(m: RawMount, stackDir: string): StackMount | null {
  const dest = (m.destination || '').trim()
  if (!dest) return null

  if (m.type === 'volume' && m.name) {
    return { kind: 'volume', name: m.name, anonymous: isAnonVolume(m.name), dest, rw: m.rw, services: [], container: '' }
  }

  if (m.type === 'bind' && m.source) {
    const src = stripTrailingSlashes(m.source)
    const root = stripTrailingSlashes(stackDir || '')
    if (root && (src === root || src.startsWith(root + '/'))) {
      return { kind: 'bind-internal', rel: src === root ? '' : src.slice(root.length + 1), dest, rw: m.rw, services: [], container: '' }
    }
    return { kind: 'bind-external', source: m.source, dest, rw: m.rw, services: [], container: '' }
  }

  return null
}

function mountKey(m: StackMount): string {
  if (m.kind === 'volume') return `v:${m.name}:${m.dest}`
  if (m.kind === 'bind-internal') return `bi:${m.rel}:${m.dest}`
  return `be:${m.source}:${m.dest}`
}

/**
 * Aggregate per-service raw mounts into a deduped, sorted list, recording which
 * services use each. Order: editable stack files first, then named volumes, then
 * external host paths — most-actionable first.
 */
export function aggregateStackMounts(
  perService: { service: string; id?: string; mounts: RawMount[] }[],
  stackDir: string,
): StackMount[] {
  const byKey = new Map<string, StackMount>()
  for (const { service, id, mounts } of perService) {
    for (const raw of mounts) {
      const c = classifyMount(raw, stackDir)
      if (!c) continue
      const row = byKey.get(mountKey(c)) ?? c
      if (row === c) byKey.set(mountKey(c), c)
      if (service && !row.services.includes(service)) row.services.push(service)
      if (id && !row.container) row.container = id // first container that has this mount
    }
  }
  const order = { 'bind-internal': 0, volume: 1, 'bind-external': 2 } as const
  const rows = [...byKey.values()]
  for (const r of rows) r.services.sort()
  return rows.sort((a, b) => (order[a.kind] !== order[b.kind] ? order[a.kind] - order[b.kind] : a.dest.localeCompare(b.dest)))
}
