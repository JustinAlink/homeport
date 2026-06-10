import type { PingMap } from '~/types/service'

/** Polls /api/pings on a slow cadence (uptime/reachability of mapped domains). */
export function usePings() {
  const pings = useState<PingMap>('hp:pings', () => ({}))
  let poll: ReturnType<typeof setInterval> | null = null

  async function refresh() {
    try {
      pings.value = await $fetch<PingMap>('/api/pings')
    } catch {
      // keep last values on transient failure
    }
  }

  function start() {
    refresh()
    if (import.meta.client && !poll) poll = setInterval(refresh, 30_000)
  }
  function stop() {
    if (poll) clearInterval(poll)
    poll = null
  }

  return { pings, refresh, start, stop }
}
