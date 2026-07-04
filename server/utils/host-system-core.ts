// Pure procfs parsers for whole-host CPU/RAM — no fs/config imports so tests
// can load this file directly (node --test cannot resolve extensionless
// relative imports; see the testing note in the repo docs).

export interface HostSystemStats {
  cpuPercent: number
  memUsed: number // bytes, total minus available (page cache NOT counted)
  memTotal: number
  memPercent: number
}

/** Parse /proc/meminfo (kB lines) → totals in bytes. */
export function parseMeminfo(text: string): { total: number; available: number } | null {
  const grab = (key: string) => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'))
    return m ? Number(m[1]) * 1024 : null
  }
  const total = grab('MemTotal')
  const available = grab('MemAvailable')
  if (total === null || available === null) return null
  return { total, available }
}

/** Parse the aggregate `cpu` line of /proc/stat → jiffy counters. */
export function parseProcStatCpu(text: string): { idle: number; total: number } | null {
  const m = text.match(/^cpu\s+(.+)$/m)
  if (!m) return null
  const f = m[1].trim().split(/\s+/).map(Number)
  if (f.length < 5 || f.some((n) => !Number.isFinite(n))) return null
  const idle = f[3] + (f[4] ?? 0) // idle + iowait
  const total = f.reduce((a, b) => a + b, 0)
  return { idle, total }
}

/** CPU busy % between two /proc/stat samples. */
export function cpuPercentBetween(
  prev: { idle: number; total: number },
  cur: { idle: number; total: number },
): number {
  const dTotal = cur.total - prev.total
  const dIdle = cur.idle - prev.idle
  if (dTotal <= 0) return 0
  return Math.min(100, Math.max(0, Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10))
}
