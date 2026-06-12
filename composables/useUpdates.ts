import type { Service } from '~/types/service'

export interface UpdateEntry {
  status: 'current' | 'update' | 'local' | 'pinned' | 'error'
  localDigest?: string
  remoteDigest?: string
  checkedAt: number
  error?: string
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

  return { enabled, entries, refresh, entryFor }
}
