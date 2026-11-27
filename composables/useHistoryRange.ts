import { bridgeGaps } from '~/utils/chartScale'

export type GraphRange = 'live' | '1h' | '6h' | '24h' | '7d' | '30d'

/** The range buttons, in order (one list for the dashboard and the service page). */
export const GRAPH_RANGES: readonly GraphRange[] = ['live', '1h', '6h', '24h', '7d', '30d']
export const rangeLabel = (r: GraphRange) => (r === 'live' ? 'Live' : r)

/**
 * Shared live/1h/6h/24h/7d/30d range state for a CPU/RAM history graph. `id` is
 * the /api/history id ('host' for the fleet, or a service id). 'live' uses the
 * caller's in-memory buffer; the ranges load persisted history here. 7d and 30d
 * come back as 15 min and 1 h averages: `intervalSec` follows what the server sent.
 */
export function useHistoryRange(id: string, defaultRange: GraphRange = 'live') {
  // A history default matters for first paint: 'live' starts empty and needs
  // ~a minute of polling, while ranges draw instantly from the collector.
  const stored = import.meta.client ? (localStorage.getItem(`hp:range:${id}`) as GraphRange | null) : null
  const range = ref<GraphRange>(stored && GRAPH_RANGES.includes(stored) ? stored : defaultRange)
  watch(range, (r) => {
    if (import.meta.client) localStorage.setItem(`hp:range:${id}`, r)
  })
  // seconds per point of the loaded history (60, 900 or 3600), set by the response
  const res = ref(60)
  const intervalSec = computed(() => (range.value === 'live' ? 7 : res.value))
  // null where nothing was recorded for a while: the graph draws a break there
  const past = ref<{ cpu: (number | null)[]; mem: (number | null)[] } | null>(null)
  // start time of each history point, for the time axis and the tooltip
  const times = ref<number[] | null>(null)
  // samples that were really recorded (bridgeGaps pads short gaps), so callers can
  // tell an empty history (fresh install, history off) from a flat one
  const realPoints = ref(0)

  // Switching 24h then 1h quickly sends two requests; the slower 24h answer
  // could land last and draw 24h data under the 1h label. Newest request wins.
  const seq = requestSequence()
  async function load() {
    if (range.value === 'live') {
      seq.invalidate() // a range still loading must not land once live is chosen
      return
    }
    const current = seq.start()
    try {
      const r = await $fetch<{ res: number; t: number[]; cpu: (number | null)[]; mem: (number | null)[] }>('/api/history', {
        params: { id, range: range.value },
      })
      if (!current()) return
      realPoints.value = r.cpu.filter((v) => v != null).length
      res.value = r.res || 60
      times.value = r.t ?? null
      past.value = { cpu: bridgeGaps(r.cpu), mem: bridgeGaps(r.mem) }
    } catch {
      if (!current()) return
      realPoints.value = 0
      times.value = null
      past.value = null
    }
  }
  watch(range, load)

  return { range, intervalSec, past, times, realPoints, load }
}
