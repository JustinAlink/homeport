import type { StatsMap, StatsResponse } from '~/types/service'
import { getConfig } from '../utils/config'
import { listContainersFor } from '../utils/docker'
import { getStatsFor, getHostInfo, aggregateHostStats } from '../utils/stats'
import { getHosts } from '../utils/hosts'
import { demoStats } from '../utils/demo'

// Per-container stats (keyed by `${hostId}::${containerId}` to match service ids)
// + a combined fleet aggregate across all hosts.
export default defineEventHandler(async (): Promise<StatsResponse> => {
  if (getConfig().demo) return demoStats()

  const containers: StatsMap = {}
  let ncpu = 0
  let memTotal = 0

  await Promise.all(
    getHosts().map(async (host) => {
      try {
        const running = (await listContainersFor(host)).filter((c) => c.state === 'running').map((c) => c.id)
        const s = await getStatsFor(host, running)
        for (const [id, st] of Object.entries(s)) containers[`${host.id}::${id}`] = st
        const info = await getHostInfo(host)
        if (info) {
          ncpu += info.ncpu
          memTotal += info.memTotal
        }
      } catch {
        // skip unreachable host
      }
    }),
  )

  return { containers, host: aggregateHostStats(containers, ncpu, memTotal) }
})
