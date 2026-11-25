import type { PingResult, Service, StatsMap } from '~/types/service'
import { version } from '../../package.json'
import { getConfig } from '../utils/config'
import { getLatestSnapshot } from '../utils/collector'
import { containerKey, getUptime } from '../utils/history'
import { buildMetrics, formatPrometheus, type MetricsInput } from '../utils/metrics-core'
import { getUpdateMap } from '../utils/updates'
import type { UpdateEntry } from '../utils/registry-core'
import { cachedPings, pingAll } from '../utils/ping'
import { findProxyName, localDomainUrls } from '../utils/ping-core'
import { getHosts } from '../utils/hosts'
import { splitServiceId } from '../utils/service-id'
import { guard } from '../utils/guard'
import { demoServices, demoStats, demoUpdates, demoPings, demoUptime } from '../utils/demo'

// GET /api/metrics: Prometheus text format, for a scrape job with a read-scope
// API token (Authorization: Bearer hp_...). Behind the normal auth like every
// /api path, and read-only: it shows what /api/services, /api/stats and
// /api/updates already show to the same callers, so it needs no switch of its own.
//
// A scrape never waits on Docker, a registry or a domain: values come from the
// collector's last snapshot (at most HOMEPORT_COLLECTOR_INTERVAL old, see
// homeport_collector_last_run_timestamp_seconds) and from the last domain checks.

const WINDOWS = { '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000 }
// domain results older than this are left out rather than reported as current
const PING_MAX_AGE_MS = 5 * 60_000
// re-check in the background at most once a minute, however often Prometheus scrapes
const PING_REFRESH_MS = 60_000
const refreshPings = guard((urls: string[], proxyFor: (url: string) => string | null) => pingAll(urls, Date.now(), proxyFor))

const updateOf = (e: UpdateEntry | undefined): boolean | null =>
  e?.status === 'update' ? true : e?.status === 'current' || e?.status === 'pinned' ? false : null

export default defineEventHandler((event) => {
  const cfg = getConfig()
  let services: Service[]
  let stats: StatsMap
  let hosts: { id: string; online: boolean }[]
  let collectedAt: number | null = null
  if (cfg.demo) {
    const sv = demoServices()
    services = sv.services
    stats = demoStats().containers
    hosts = sv.hosts.map((h) => ({ id: h.id, online: h.online }))
  } else {
    const snap = getLatestSnapshot()
    // Before the first collector tick (or while every tick fails) there is nothing
    // true to report: a failed scrape (up == 0 in Prometheus) says exactly that.
    if (!snap) throw createError({ statusCode: 503, statusMessage: 'No snapshot yet: the collector has not run' })
    services = snap.services
    stats = snap.stats
    hosts = Object.entries(snap.hostsOnline).map(([id, online]) => ({ id, online }))
    collectedAt = snap.at
  }

  const containers = services.filter((s) => s.kind === 'container')
  const updates = cfg.demo ? demoUpdates() : cfg.updateCheckEnabled ? getUpdateMap() : null
  const historyOn = cfg.demo || cfg.historyEnabled

  let domains: MetricsInput['domains'] = null
  if (cfg.pingEnabled || cfg.demo) {
    const targets = new Map<string, { domain: string; name: string; host: string }>()
    for (const s of containers) {
      if (s.state !== 'running') continue
      for (const d of s.domains) if (!targets.has(d.url)) targets.set(d.url, { domain: d.domain, name: s.name, host: splitServiceId(s.id).hostId })
    }
    let results: Record<string, PingResult>
    if (cfg.demo) results = demoPings()
    else {
      const urls = [...targets.keys()]
      const cached = cachedPings(urls, Date.now(), PING_MAX_AGE_MS, PING_REFRESH_MS)
      results = cached.results
      if (cached.due && urls.length) {
        const localHost = getHosts()[0]?.name
        const proxy = findProxyName(services, localHost)
        const local = localDomainUrls(services, localHost)
        void refreshPings(urls, (url) => (local.has(url) ? proxy : null)).catch(() => {})
      }
    }
    domains = [...targets].filter(([url]) => results[url]).map(([url, t]) => ({ ...t, status: results[url].status, ms: results[url].ms }))
  }

  const body = formatPrometheus(
    buildMetrics({
      version,
      collectedAt,
      hosts,
      containers: containers.map((s) => {
        const { hostId } = splitServiceId(s.id)
        const st = stats[s.id]
        const key = containerKey(s)
        return {
          name: s.name,
          host: hostId,
          project: s.project,
          image: s.image,
          running: s.state === 'running',
          health: s.health,
          cpuPercent: st?.cpuPercent ?? null,
          memBytes: st ? st.memBytes : null,
          updateAvailable: updates ? updateOf(updates[`${hostId}|${s.image}`]) : null,
          uptime: historyOn
            ? Object.fromEntries(Object.entries(WINDOWS).map(([w, ms]) => [w, (cfg.demo ? demoUptime(key, ms) : getUptime(key, ms)).ratio]))
            : null,
        }
      }),
      domains,
    }),
  )
  setResponseHeader(event, 'content-type', 'text/plain; version=0.0.4; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return body
})
