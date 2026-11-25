import { getConfig } from '../utils/config'
import { containerKey, getUptime, getUptimeDays } from '../utils/history'
import type { Uptime } from '../utils/history-core'
import { getLatestSnapshot } from '../utils/collector'
import { buildServices } from '../utils/compose'
import { seriesKeyFor } from '../utils/series-key'
import { demoUptime, demoUptimeDays } from '../utils/demo'

// Container uptime: the share of collector samples in which a container was
// running and not unhealthy (history-core countsAsUp), over 24 h, 7 d and 30 d.
//   GET /api/uptime?id=<service id or container key>[&days=30][&tz=<minutes>]
//     → { enabled, key, windows: { '24h', '7d', '30d' }, days: [...] } (days: per
//       calendar day in the caller's zone, tz = Date#getTimezoneOffset())
//   GET /api/uptime → { enabled, services: [{ key, id, name, host, windows }] }
// Read-only and auth-gated like the rest of /api; a status page can build on it.

const WINDOWS = { '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000 } as const
type Windows = Record<keyof typeof WINDOWS, Uptime>

export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const q = getQuery(event)
  const windowsOf = (key: string): Windows =>
    Object.fromEntries(
      Object.entries(WINDOWS).map(([w, ms]) => [w, cfg.demo ? demoUptime(key, ms) : getUptime(key, ms)]),
    ) as Windows

  // history off: nothing is recorded, so there is nothing honest to report
  if (!cfg.historyEnabled && !cfg.demo) return { enabled: false }

  if (q.id !== undefined) {
    const key = await seriesKeyFor(String(q.id))
    if (!key || key === 'host' || key === 'host-system') throw createError({ statusCode: 404, statusMessage: 'No such container' })
    const days = Math.min(30, Math.max(1, Math.floor(Number(q.days) || 30)))
    // getTimezoneOffset is within -14 h .. +12 h; anything else means "UTC"
    const tz = Number(q.tz)
    const tzOffset = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? Math.round(tz) : 0
    return {
      enabled: true,
      key,
      windows: windowsOf(key),
      days: cfg.demo ? demoUptimeDays(key, days, tzOffset) : getUptimeDays(key, days, tzOffset),
    }
  }

  const services = getLatestSnapshot()?.services ?? (await buildServices()).services
  return {
    enabled: true,
    services: services
      .filter((s) => s.kind === 'container')
      .map((s) => {
        const key = containerKey(s)
        return { key, id: s.id, name: s.displayName, host: s.host ?? null, windows: windowsOf(key) }
      }),
  }
})
