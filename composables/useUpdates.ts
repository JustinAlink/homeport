import type { Service } from '~/types/service'

export interface UpdateEntry {
  status: 'current' | 'update' | 'local' | 'pinned' | 'error'
  localDigest?: string
  remoteDigest?: string
  checkedAt: number
  error?: string
}

// Duplicated from server/utils/registry-core.ts (no shared/ dir in this app — server
// code isn't imported into the client bundle, so this small helper is kept in sync by hand).
function parseImageRefClient(image: string): { registry: string; repo: string } {
  let rest = image.trim()
  const at = rest.indexOf('@')
  if (at >= 0) rest = rest.slice(0, at)

  let registry = 'docker.io'
  const slash = rest.indexOf('/')
  if (slash > 0) {
    const first = rest.slice(0, slash)
    if (first.includes('.') || first.includes(':') || first === 'localhost') {
      registry = first
      rest = rest.slice(slash + 1)
    }
  }

  const colon = rest.lastIndexOf(':')
  if (colon > rest.lastIndexOf('/')) rest = rest.slice(0, colon)

  let repo = rest
  if (registry === 'docker.io' && !repo.includes('/')) repo = `library/${repo}`

  return { registry, repo }
}

/**
 * Best-effort changelog/releases URL for an image — see server/utils/registry-core.ts's
 * changelogUrlFor() for the full rationale (kept identical here, no live verification).
 */
function changelogUrlForImage(image: string): string | undefined {
  const { registry, repo } = parseImageRefClient(image)
  const parts = repo.split('/')

  if (registry === 'ghcr.io') {
    if (parts.length !== 2) return undefined
    const [owner, name] = parts
    return `https://github.com/${owner}/${name}/releases`
  }

  if (registry === 'docker.io') {
    if (parts.length !== 2 || parts[0] === 'library') return undefined
    const [owner, name] = parts
    return `https://github.com/${owner}/${name}/releases`
  }

  return undefined
}

/** Image-update statuses keyed `${hostId}|${image}`; shared app-wide. */
export function useUpdates() {
  const enabled = useState('hp:upd-enabled', () => false)
  const entries = useState<Record<string, UpdateEntry>>('hp:upd', () => ({}))

  async function refresh() {
    try {
      const r = await $fetch<{ enabled: boolean; entries: Record<string, UpdateEntry> }>('/api/updates')
      enabled.value = r.enabled
      entries.value = r.entries
    } catch {
      // keep last
    }
  }

  const hostKeyOf = (s: Service) => {
    const sep = s.id.indexOf('::')
    return sep >= 0 ? s.id.slice(0, sep) : 'default'
  }

  function entryFor(s: Service): UpdateEntry | undefined {
    return entries.value[`${hostKeyOf(s)}|${s.image}`]
  }

  function changelogUrlFor(s: Service): string | undefined {
    return changelogUrlForImage(s.image)
  }

  return { enabled, entries, refresh, entryFor, changelogUrlFor }
}
