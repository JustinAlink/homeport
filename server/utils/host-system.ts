import { readFileSync } from 'node:fs'
import { getConfig } from './config'
import {
  cpuPercentBetween,
  parseMeminfo,
  parseProcStatCpu,
  type HostSystemStats,
} from './host-system-core'

// Whole-host CPU/RAM from procfs. Inside a container /proc/meminfo and
// /proc/stat are NOT namespaced — they show HOST-wide values — so this works
// without extra mounts when homeport watches the machine it runs on.
// HOMEPORT_HOST_PROC overrides the path (or 'off' disables). Remote
// (ssh://, tcp:// to another machine) hosts can't be read this way; the
// system series is simply absent for them.

let prevCpu: { idle: number; total: number } | null = null

/** Read current host system stats (null when disabled/unreadable/first CPU sample). */
export function readHostSystem(): HostSystemStats | null {
  const base = getConfig().hostProcPath
  if (!base) return null
  let mem: ReturnType<typeof parseMeminfo>
  let cpu: ReturnType<typeof parseProcStatCpu>
  try {
    mem = parseMeminfo(readFileSync(`${base}/meminfo`, 'utf8'))
    cpu = parseProcStatCpu(readFileSync(`${base}/stat`, 'utf8'))
  } catch {
    return null
  }
  if (!mem || !cpu) return null

  const cpuPercent = prevCpu ? cpuPercentBetween(prevCpu, cpu) : 0
  prevCpu = cpu

  const memUsed = mem.total - mem.available
  return {
    cpuPercent,
    memUsed,
    memTotal: mem.total,
    memPercent: mem.total ? Math.round((memUsed / mem.total) * 1000) / 10 : 0,
  }
}
