import type { Service, StatsMap, HostStats } from '~/types/service'
import { buildServices } from './compose'
import { collectStats } from './stats'
import { recordHistory } from './history'
import { evaluateAlerts } from './alerts'
import { runUpdateSweep } from './updates'
import { guard } from './guard'

// A periodic fleet snapshot held in a module singleton. node-server runs as a
// single process, so this is authoritative. The background plugin
// (server/plugins/collector.ts) calls runCollectorTick() on an interval; the
// snapshot feeds the history store and the alert engine. Live API endpoints
// (/api/services, /api/stats) stay independent and fresher — the collector is additive.
//
// NOTE: multi-replica deployments would double-collect and double-notify. That's
// out of scope by design (homeport is a single-container tool).

export interface Snapshot {
  at: number
  services: Service[]
  stats: StatsMap
  host: HostStats | null
  hostsOnline: Record<string, boolean>
}

let latest: Snapshot | null = null

export function getLatestSnapshot(): Snapshot | null {
  return latest
}

/** One collection pass: services + stats across all hosts. Reuses the live pipelines. */
export async function collectOnce(): Promise<Snapshot> {
  const [svc, stats] = await Promise.all([buildServices(), collectStats()])
  const hostsOnline: Record<string, boolean> = {}
  for (const h of svc.hosts) hostsOnline[h.id] = h.online
  return {
    at: Date.now(),
    services: svc.services,
    stats: stats.containers,
    host: stats.host,
    hostsOnline,
  }
}

const tick = guard(async () => {
  const snap = await collectOnce()
  latest = snap
  await recordHistory(snap)
  await evaluateAlerts(snap)
  // self-throttled (per-image interval) + no-op unless updateCheckEnabled
  await runUpdateSweep(false)
  return snap
})

/** Guarded single tick used by the background plugin. Errors are swallowed by callers. */
export async function runCollectorTick(): Promise<void> {
  await tick()
}
