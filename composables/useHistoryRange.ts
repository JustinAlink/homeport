export type GraphRange = 'live' | '1h' | '6h' | '24h'

/** Forward-fill nulls (history gaps) so a graphed line stays continuous. */
export function fillGaps(a: (number | null)[]): number[] {
  let last = 0
  return a.map((v) => (v == null ? last : (last = v)))
}

/**
 * Shared live/1h/6h/24h range state for a CPU/RAM history graph. `id` is the
 * /api/history id ('host' for the fleet, or a service id). 'live' uses the
 * caller's in-memory buffer; the ranges load persisted history here.
 */
const RANGES: GraphRange[] = ['live', '1h', '6h', '24h']

export function useHistoryRange(id: string, defaultRange: GraphRange = 'live') {
  // A history default matters for first paint: 'live' starts empty and needs
  // ~a minute of polling, while ranges draw instantly from the collector.
  const stored = import.meta.client ? (localStorage.getItem(`hp:range:${id}`) as GraphRange | null) : null
  const range = ref<GraphRange>(stored && RANGES.includes(stored) ? stored : defaultRange)
  watch(range, (r) => {
    if (import.meta.client) localStorage.setItem(`hp:range:${id}`, r)
  })
  const intervalSec = computed(() => (range.value === 'live' ? 7 : 60))
  const past = ref<{ cpu: number[]; mem: number[] } | null>(null)

  async function load() {
    if (range.value === 'live') return
    try {
      const r = await $fetch<{ cpu: (number | null)[]; mem: (number | null)[] }>('/api/history', {
        params: { id, range: range.value },
      })
      past.value = { cpu: fillGaps(r.cpu), mem: fillGaps(r.mem) }
    } catch {
      past.value = null
    }
  }
  watch(range, load)

  return { range, intervalSec, past, load }
}
