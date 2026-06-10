import type { ContainerStats, StatsMap } from '~/types/service'
import { getDocker } from './docker'

// One-shot CPU% using Docker's standard delta formula. With stream:false the
// daemon includes a ~1s-old precpu sample, so a single read is enough; if it's
// missing/zero we return null rather than a bogus number.
function cpuPercent(s: any): number | null {
  try {
    const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage
    const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage
    const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1
    if (!sysDelta || sysDelta <= 0 || cpuDelta < 0) return null
    return Math.round((cpuDelta / sysDelta) * cpus * 100 * 10) / 10
  } catch {
    return null
  }
}

function memUsage(s: any): { used: number; limit: number } {
  // "Real" usage = usage minus inactive file cache (matches `docker stats`).
  const usage = s.memory_stats?.usage || 0
  const inactive = s.memory_stats?.stats?.inactive_file ?? s.memory_stats?.stats?.total_inactive_file ?? 0
  return { used: Math.max(0, usage - inactive), limit: s.memory_stats?.limit || 0 }
}

/** Fetch one-shot stats for the given container ids, with bounded concurrency. */
export async function getStats(ids: string[]): Promise<StatsMap> {
  const docker = getDocker()
  const out: StatsMap = {}
  const queue = [...ids]

  async function worker() {
    while (queue.length) {
      const id = queue.shift()!
      try {
        const s: any = await docker.getContainer(id).stats({ stream: false })
        const { used, limit } = memUsage(s)
        const stat: ContainerStats = {
          cpuPercent: cpuPercent(s),
          memBytes: used,
          memLimitBytes: limit,
          memPercent: limit ? Math.round((used / limit) * 1000) / 10 : null,
        }
        out[id] = stat
      } catch {
        // container vanished / stats unavailable — skip
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, ids.length || 1) }, worker))
  return out
}
