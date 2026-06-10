import { getConfig } from '../utils/config'
import { listContainers } from '../utils/docker'
import { getStats } from '../utils/stats'
import { demoStats } from '../utils/demo'

// Separate from /api/services so the (relatively expensive) per-container stats
// poll on its own slower cadence and never slows the main service list.
export default defineEventHandler(async () => {
  if (getConfig().demo) return demoStats()
  try {
    const running = (await listContainers()).filter((c) => c.state === 'running').map((c) => c.id)
    return await getStats(running)
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `Stats unavailable: ${err?.message || err}` })
  }
})
