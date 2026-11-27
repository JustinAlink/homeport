import type { Service } from '~/types/service'
import { getConfig, getStatusPageConfig } from './config'
import { readSettings } from './settings'
import { getLatestSnapshot } from './collector'
import { containerKey, getUptime, getUptimeDays } from './history'
import { splitServiceId } from './service-id'
import { demoServices, demoPings, demoUptime, demoUptimeDays, demoDomainSeries } from './demo'
import { buildPublicStatus, domainStatusState, statusDomainKey, type PublicStatus, type StatusPageItem, type UptimeWindow } from '../../shared/utils/status-page.ts'
import { domainUrls, statusDomainCheck } from './status-domains'

// Gathers what the public status page needs and hands it to the pure core
// (shared/utils/status-page.ts), which decides what a visitor may see.
//
// A public request never touches Docker, a registry or the network: container
// states come from the collector's last snapshot, domain states from the check
// the collector made of each picked domain (status-domains.ts). Either way the
// state is the same observation as the newest uptime sample, so they agree;
// and the answer is cached per time zone for 30 seconds. However often /status is
// asked for, homeport does at most one build per time zone per 30 seconds.

const WINDOWS: Record<UptimeWindow, number> = { '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000 }
const DAYS = 30
// a domain check older than this says nothing about now (the collector makes one every tick)
const PING_MAX_AGE_MS = 5 * 60_000
export const STATUS_CACHE_MS = 30_000

/** The page as a visitor in this time zone sees it (uncached: the preview uses it as is). */
export function computePublicStatus(tzOffsetMin: number, now = Date.now()): PublicStatus {
  const cfg = getConfig()
  let services: Service[]
  let online: Record<string, boolean>
  if (cfg.demo) {
    const sv = demoServices()
    services = sv.services
    online = Object.fromEntries(sv.hosts.map((h) => [h.id, h.online]))
  } else {
    // before the first collector run there is nothing true to say: everything reads unknown
    const snap = getLatestSnapshot()
    services = snap?.services ?? []
    online = snap?.hostsOnline ?? {}
  }
  const byKey = new Map<string, Service>()
  for (const s of services) if (s.kind === 'container') byKey.set(containerKey(s), s)
  const urls = domainUrls(services)
  const demoChecks = cfg.demo ? demoPings() : {}
  const check = (domain: string) => {
    if (!cfg.demo) return cfg.pingEnabled ? statusDomainCheck(domain, now, PING_MAX_AGE_MS) : null
    const url = urls.get(domain)
    return url ? demoChecks[url] ?? null : null
  }
  const historyOn = cfg.demo || cfg.historyEnabled

  // the series behind an item (the demo makes up a history for any key, so there
  // only for what is in its fleet, and a domain's must agree with its demo check)
  const seriesOf = (it: StatusPageItem): string | null => {
    if (it.kind === 'container') return !cfg.demo || byKey.has(it.ref) ? it.ref : null
    if (!cfg.demo) return statusDomainKey(it.ref)
    const owner = services.find((s) => s.kind === 'container' && s.domains.some((d) => d.domain === it.ref))
    const c = check(it.ref)
    return owner && c ? demoDomainSeries(it.ref, containerKey(owner), domainStatusState(c) === 'down') : null
  }

  return buildPublicStatus(getStatusPageConfig(), {
    now,
    container(key) {
      const s = byKey.get(key)
      if (!s) return null
      return online[splitServiceId(s.id).hostId] === false ? 'offline' : { state: s.state, health: s.health }
    },
    domain: check,
    uptime(it) {
      // history off: nothing is recorded, so there is nothing honest to show
      const key = historyOn ? seriesOf(it) : null
      if (!key) return null
      const windows = Object.fromEntries(
        Object.entries(WINDOWS).map(([w, ms]) => [w, (cfg.demo ? demoUptime(key, ms) : getUptime(key, ms, now)).ratio]),
      ) as Record<UptimeWindow, number | null>
      const days = cfg.demo ? demoUptimeDays(key, DAYS, tzOffsetMin) : getUptimeDays(key, DAYS, tzOffsetMin, now)
      return { windows, days: days.map((d) => ({ from: d.from, ratio: d.ratio })) }
    },
  })
}

// time zone offset → the last answer. At most 113 entries (normalizeTzOffset); an
// entry is also stale once the settings change, so a saved edit shows at once.
const cache = new Map<number, { at: number; settings: object; body: PublicStatus }>()

/** The public answer, built at most once per time zone per STATUS_CACHE_MS. */
export function cachedPublicStatus(tzOffsetMin: number, now = Date.now()): PublicStatus {
  const settings = readSettings()
  const hit = cache.get(tzOffsetMin)
  if (hit && now - hit.at < STATUS_CACHE_MS && hit.settings === settings) return hit.body
  const body = computePublicStatus(tzOffsetMin, now)
  cache.set(tzOffsetMin, { at: now, settings, body })
  return body
}
