import type { Service, StatsMap, HostStats } from '~/types/service'
import { buildServices } from './compose'
import { collectStats } from './stats'
import { recordHistory } from './history'
import { evaluateAlerts, evaluateDomainAlerts } from './alerts'
import { runUpdateSweep } from './updates'
import { maybeAutoUpdate } from './auto-update'
import { runCertChecks } from './certs'
import { maybeAutoSync } from './git-webhooks'
import { guard } from './guard'
import { log } from './log'

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

let latest: Snapshot | null = null

/** Most recent collector snapshot (null before the first tick). */
export function getLatestSnapshot(): Snapshot | null {
  return latest
}

/** Run one collector stage in isolation — a failure is logged, not fatal to the tick. */
async function stage(name: string, fn: () => unknown): Promise<void> {
  try {
    await fn()
  } catch (e) {
    log.error('collector', `${name} failed`, e)
  }
}

const tick = guard(async () => {
  // collectOnce is the one stage whose failure should abort the tick — without a
  // snapshot the rest have nothing to work on (it re-throws to the plugin's catch).
  const snap = await collectOnce()
  latest = snap
  // Isolate the downstream subsystems: a broken alert channel or a read-only
  // history volume must not stop the others (they used to share one try).
  await stage('history', () => recordHistory(snap))
  await stage('alerts', () => evaluateAlerts(snap))
  await stage('domain-alerts', () => evaluateDomainAlerts(snap))
  // Update work runs beside the tick, not inside it: a multi-GB pull at the
  // auto-update hour (or a registry that hangs) used to hold the tick's guard, so
  // every tick in the meantime was skipped and there were no alerts or history
  // until it finished. Both are guarded on their own, so a chain started while
  // the previous one runs is a no-op.
  void updateChain()
  // auto-sync of git stacks: beside the update chain, not in it, so the nightly
  // auto-update's pulls never delay a stack that follows a branch (guarded too)
  void stage('git-auto-sync', () => maybeAutoSync())
  return snap
})

async function updateChain(): Promise<void> {
  // certificates: their own schedule (daily, hourly near expiry), so cheap to call every tick
  const snap = latest
  if (snap) await stage('certs', () => runCertChecks(snap.services))
  // self-throttled (per-image interval) + no-op unless updateCheckEnabled
  await stage('update-sweep', () => runUpdateSweep(false))
  // once per day in its configured hour + no-op unless autoUpdateEnabled
  await stage('auto-update', () => maybeAutoUpdate())
}

/** Guarded single tick used by the background plugin. A collectOnce failure rejects (logged by the caller). */
export async function runCollectorTick(): Promise<void> {
  await tick()
}
