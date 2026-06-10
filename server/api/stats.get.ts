import type { StatsResponse } from '~/types/service'
import { getConfig } from '../utils/config'
import { listContainers } from '../utils/docker'
import { getStats, getHostStats } from '../utils/stats'
import { demoStats } from '../utils/demo'

// Per-container stats + a fleet/host aggregate. Polled on its own slower cadence.
export default defineEventHandler(async (): Promise<StatsResponse> => {
  if (getConfig().demo) return demoStats()
  try {
    const running = (await listContainers()).filter((c) => c.state === 'running').map((c) => c.id)
    const containers = await getStats(running)
    const host = await getHostStats(containers)
    return { containers, host }
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `Stats unavailable: ${err?.message || err}` })
  }
})
