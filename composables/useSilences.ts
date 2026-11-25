import type { MaintenanceWindow, Snooze } from '~/shared/utils/silence'

export interface SilencesView {
  snoozes: Record<string, Snooze>
  pausedUntil: number
  pauseNote: string | null
  windows: MaintenanceWindow[]
  activeWindow: MaintenanceWindow | null
  timeZone: string
  serverTime: number
}

/** The stable key the server snoozes by: `<hostId>|<container name>`. */
export function appKey(s: { id: string; name: string }): string {
  const sep = s.id.indexOf('::')
  return `${sep >= 0 ? s.id.slice(0, sep) : 'default'}|${s.name}`
}

/**
 * Alert silences, shared app-wide: the banner, the dashboard's bell icons and the
 * snooze menu all read the same state, so a snooze shows everywhere at once.
 */
export function useSilences() {
  const data = useState<SilencesView | null>('hp:silences', () => null)
  async function refresh() {
    try {
      data.value = await $fetch<SilencesView>('/api/alerts/silences')
    } catch {
      // keep the last known state; silences are an overlay, not the page
    }
  }
  async function snooze(key: string, until: number | null, note?: string) {
    await $fetch('/api/alerts/snooze', { method: 'POST', body: { key, until, note } })
    await refresh()
  }
  async function pause(until: number | null, note?: string) {
    await $fetch('/api/alerts/pause', { method: 'POST', body: { until, note } })
    await refresh()
  }
  const snoozeOf = (s: { id: string; name: string }) => {
    const sn = data.value?.snoozes[appKey(s)]
    return sn && sn.until > Date.now() ? sn : null
  }
  /** Everything is silent right now: a pause or a running maintenance window. */
  const globalSilence = computed(() => {
    const d = data.value
    if (!d) return null
    if (d.pausedUntil > Date.now()) return { kind: 'pause' as const, until: d.pausedUntil, note: d.pauseNote }
    if (d.activeWindow) return { kind: 'window' as const, window: d.activeWindow }
    return null
  })
  return { data, refresh, snooze, pause, snoozeOf, globalSilence }
}

/** Snooze presets: an hour, a work day, until tomorrow morning, a week. */
export function snoozePresets(now = Date.now()): { label: string; until: number }[] {
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  return [
    { label: '1 hour', until: now + 3600_000 },
    { label: '8 hours', until: now + 8 * 3600_000 },
    { label: 'Until tomorrow 09:00', until: tomorrow.getTime() },
    { label: '1 week', until: now + 7 * 24 * 3600_000 },
  ]
}

/** "until 14:30", "until tomorrow 09:00", "until Fri 09:00", in the browser's time. */
export function untilText(until: number, now = Date.now()): string {
  const d = new Date(until)
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const days = Math.floor((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return `until ${hm}`
  if (days === 1) return `until tomorrow ${hm}`
  if (days < 7) return `until ${d.toLocaleDateString([], { weekday: 'short' })} ${hm}`
  return `until ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm}`
}
