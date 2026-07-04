import type { StatsResponse } from '~/types/service'
import { collectStats } from '../utils/stats'
import { getLatestSnapshot } from '../utils/collector'
import { getConfig } from '../utils/config'

// Per-container stats (keyed by `${hostId}::${containerId}` to match service ids)
// + a combined fleet aggregate across all hosts.
//
// Serves the background collector's snapshot when it's fresh: on big fleets a
// live sweep takes many seconds (one-shot docker stats per container), which
// made first paint slow. ?live=1 forces a sweep.
export default defineEventHandler(async (event): Promise<StatsResponse> => {
  const live = String(getQuery(event).live || '') === '1'
  if (!live) {
    const snap = getLatestSnapshot()
    const maxAgeMs = Math.max(getConfig().collectorInterval * 2, 90) * 1000
    if (snap && Date.now() - snap.at < maxAgeMs) {
      return { containers: snap.stats, host: snap.host }
    }
  }
  return collectStats()
})
