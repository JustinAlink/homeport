import { version } from '../../package.json'
import { getConfig } from './config'
import { buildServices } from './compose'
import { getLatestSnapshot } from './collector'
import { getUpdateMap } from './updates'
import { getExposure } from './exposure'
import { recentAlerts } from './alerts'
import { getHosts } from './hosts'
import { getDockerFor } from './docker'
import { splitServiceId } from './service-id'
import { createDemuxer, createLineSplitter, splitTimestamp } from './logs-core'
import { demoActivity, demoExposure, demoLogLines, demoStats, demoUpdates } from './demo'
import type { McpServer } from './mcp-core'
import { fleetTools, SERVER_INSTRUCTIONS, type FleetSource, type LogLineLike } from './mcp-tools-core'

// The live data behind the MCP tools: the same functions the read endpoints use
// (services, the collector's stats, the update cache, the exposure report, the alert
// log, container logs), with the demo fleet in demo mode. Each tool call builds a
// fresh source, so a capability switched in settings applies to the next call.

/** One-shot tail of a container's log (the same path as GET /api/logs?format=text). */
async function dockerLogs(id: string, tail: number): Promise<LogLineLike[]> {
  const { hostId, containerId } = splitServiceId(id)
  const host = getHosts().find((h) => h.id === hostId)
  if (!host) throw new Error('unknown host')
  // dockerode returns a Buffer when follow is false
  const buf = (await getDockerFor(host).getContainer(containerId).logs({ follow: false, stdout: true, stderr: true, tail, timestamps: true })) as unknown as Buffer
  const demux = createDemuxer()
  const split = createLineSplitter()
  const out: LogLineLike[] = []
  const add = (l: { s: 'stdout' | 'stderr'; line: string }) => out.push({ s: l.s, ...splitTimestamp(l.line) })
  for (const seg of demux.push(new Uint8Array(buf))) split.push(seg).forEach(add)
  split.flush().forEach(add)
  return out
}

export function fleetSource(): FleetSource {
  const cfg = getConfig()
  return {
    services: () => buildServices(),
    async stats() {
      if (cfg.demo) return demoStats().containers
      // the collector's last sample: a live sweep takes seconds on a big fleet, too
      // slow for a question, and a stale figure is worse than none
      const snap = getLatestSnapshot()
      const maxAge = Math.max(cfg.collectorInterval * 2, 90) * 1000
      return snap && Date.now() - snap.at < maxAge ? snap.stats : null
    },
    async updates() {
      if (!cfg.updateCheckEnabled && !cfg.demo) return { enabled: false, entries: {} }
      return { enabled: true, entries: cfg.demo ? demoUpdates() : getUpdateMap() }
    },
    exposure: (opts) => (cfg.demo ? Promise.resolve(demoExposure(opts)) : getExposure(opts)),
    // the demo's alert log is empty (no collector runs), so it shows the activity feed's events
    alerts: async (limit) => (cfg.demo ? demoActivity().slice(0, limit) : recentAlerts(limit)),
    logs: !cfg.logsEnabled ? null : cfg.demo ? async (id, tail) => demoLogLines(id, Math.min(tail, 200)) : dockerLogs,
    alertsEnabled: cfg.alertsEnabled || cfg.demo,
    now: Date.now(),
  }
}

export const homeportMcp: McpServer<FleetSource> = {
  name: 'homeport',
  title: 'homeport',
  version,
  instructions: SERVER_INSTRUCTIONS,
  tools: fleetTools,
}
