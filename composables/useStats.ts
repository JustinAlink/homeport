import type { HostStats, StatsMap, StatsResponse } from '~/types/service'

export interface StatHistory {
  cpu: number[]
  mem: number[] // MiB for containers, percent for host
}

const MAX = 40 // ~5 min at a 7s poll

/** Polls /api/stats, exposes current per-container + host stats, and keeps a
 *  rolling client-side history for live sparklines. */
export function useStats() {
  const stats = useState<StatsMap>('hp:stats', () => ({}))
  const host = useState<HostStats | null>('hp:host', () => null)
  const history = useState<Record<string, StatHistory>>('hp:hist', () => ({}))
  const hostHistory = useState<StatHistory>('hp:hosthist', () => ({ cpu: [], mem: [] }))
  let poll: ReturnType<typeof setInterval> | null = null

  const push = (arr: number[], v: number) => {
    const next = [...arr, v]
    return next.length > MAX ? next.slice(next.length - MAX) : next
  }

  async function refresh() {
    try {
      const r = await $fetch<StatsResponse>('/api/stats')
      stats.value = r.containers
      host.value = r.host

      const hist: Record<string, StatHistory> = { ...history.value }
      for (const [id, s] of Object.entries(r.containers)) {
        const prev = hist[id] ?? { cpu: [], mem: [] }
        hist[id] = {
          cpu: push(prev.cpu, s.cpuPercent ?? 0),
          mem: push(prev.mem, Math.round(s.memBytes / 1048576)),
        }
      }
      history.value = hist

      if (r.host) {
        hostHistory.value = {
          cpu: push(hostHistory.value.cpu, r.host.cpuPercent),
          mem: push(hostHistory.value.mem, r.host.memPercent),
        }
      }
    } catch {
      // keep last values
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

  return { stats, host, history, hostHistory, refresh, start, stop }
}
