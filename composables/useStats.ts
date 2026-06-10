import type { StatsMap } from '~/types/service'

/** Polls /api/stats on a slower cadence than the service list. */
export function useStats() {
  const stats = useState<StatsMap>('hp:stats', () => ({}))
  let poll: ReturnType<typeof setInterval> | null = null

  async function refresh() {
    try {
      stats.value = await $fetch<StatsMap>('/api/stats')
    } catch {
      // leave the last values in place on a transient failure
    }
  }

  function start() {
    refresh()
    if (import.meta.client && !poll) poll = setInterval(refresh, 7000)
  }

  function stop() {
    if (poll) clearInterval(poll)
    poll = null
  }

  return { stats, refresh, start, stop }
}
