import type { ContainerStats, HostStats, StatsMap, StatsResponse } from '~/types/service'
import type { HostConfig } from './hosts'
import { getDockerFor, listContainersFor } from './docker'
import { getHosts } from './hosts'
import { getConfig } from './config'
import { demoStats } from './demo'

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

/** Fetch one-shot stats for the given container ids on a host, bounded concurrency. */
export async function getStatsFor(host: HostConfig, ids: string[]): Promise<StatsMap> {
  const docker = getDockerFor(host)
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

/** One host's capacity (CPU cores + total RAM from `docker info`). */
export async function getHostInfo(host: HostConfig): Promise<{ ncpu: number; memTotal: number } | null> {
  try {
    const info: any = await getDockerFor(host).info()
    return { ncpu: info.NCPU || 1, memTotal: info.MemTotal || 0 }
  } catch {
    return null
  }
}

/**
 * Full fleet stats across every host: per-container map (keyed `${hostId}::${cid}`
 * to match service ids) plus a combined host aggregate. Used by both the /api/stats
 * endpoint and the background collector.
 */
export async function collectStats(): Promise<StatsResponse> {
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
}

/** Aggregate fleet usage vs host capacity across all containers + hosts. */
export function aggregateHostStats(containers: StatsMap, ncpu: number, memTotal: number): HostStats | null {
  if (!ncpu && !memTotal) return null
  const vals = Object.values(containers)
  const cpuSum = vals.reduce((a, s) => a + (s.cpuPercent || 0), 0)
  const memUsed = vals.reduce((a, s) => a + s.memBytes, 0)
  return {
    ncpu,
    cpuPercent: ncpu ? Math.round((cpuSum / ncpu) * 10) / 10 : 0,
    memUsed,
    memTotal,
    memPercent: memTotal ? Math.round((memUsed / memTotal) * 1000) / 10 : 0,
  }
}
