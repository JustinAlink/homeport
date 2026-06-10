import type { StatsResponse } from '~/types/service'
import { collectStats } from '../utils/stats'

// Per-container stats (keyed by `${hostId}::${containerId}` to match service ids)
// + a combined fleet aggregate across all hosts.
export default defineEventHandler((): Promise<StatsResponse> => collectStats())
