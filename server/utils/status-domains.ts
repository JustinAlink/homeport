import type { Service } from '~/types/service'
import type { Snapshot } from './collector'
import { getConfig, getEnvLocks, getStatusPageConfig } from './config'
import { recordUptimeSample } from './history'
import { pingAll } from './ping'
import { findProxyName, localDomainUrls } from './ping-core'
import { getHosts } from './hosts'
import { domainDown } from './alerts-core'
import { statusDomainKey } from '../../shared/utils/status-page.ts'

// Domain uptime for the status page. Containers get their uptime from every
// collector run already; a domain has none until something checks it, so the
// collector calls recordStatusPage on each tick. A module of its own because the
// collector imports it (status-page.ts imports the collector).

// The status page reads a domain's state from here, not from the shared ping
// cache: then the state and the uptime sample are the same check, and the page
// can't say Down (a newer check from elsewhere) beside a day that has no down sample.
const lastCheck = new Map<string, { at: number; status: number }>()

/** The last check this stage recorded for a domain, if it is younger than maxAgeMs. */
export function statusDomainCheck(domain: string, now: number, maxAgeMs: number): { status: number } | null {
  const c = lastCheck.get(domain)
  return c && now - c.at <= maxAgeMs ? { status: c.status } : null
}

/** domain name → the URL homeport checks for it (the first service that lists it). */
export function domainUrls(services: Service[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of services) for (const d of s.domains) if (!out.has(d.domain)) out.set(d.domain, d.url)
  return out
}

/**
 * Collector stage: check the picked domains and record whether each answered.
 * Only picked domains, so a status page costs one request per picked domain per
 * tick (shared with the domain alerts through the ping cache). It records while
 * the page is off too, so the preview has data and the page has a history on the
 * day it goes public; a page locked off by HOMEPORT_STATUS_PAGE=false records nothing.
 */
export async function recordStatusPage(snap: Snapshot): Promise<void> {
  const cfg = getConfig()
  if (!cfg.pingEnabled || (getEnvLocks().statusPage && !cfg.statusPageEnabled)) return
  const picked = getStatusPageConfig().groups.flatMap((g) => g.items.filter((i) => i.kind === 'domain'))
  if (!picked.length) return
  const urls = domainUrls(snap.services)
  const targets = picked.flatMap((it) => (urls.has(it.ref) ? [{ domain: it.ref, url: urls.get(it.ref)! }] : []))
  if (!targets.length) return
  const localHost = getHosts()[0]?.name
  const proxy = findProxyName(snap.services, localHost)
  const local = localDomainUrls(snap.services, localHost)
  const results = await pingAll(targets.map((t) => t.url), snap.at, (url) => (local.has(url) ? proxy : null))
  for (const t of targets) {
    const r = results[t.url]
    if (!r) continue
    lastCheck.set(t.domain, { at: snap.at, status: r.status })
    recordUptimeSample(statusDomainKey(t.domain), snap.at, !domainDown(r))
  }
  // forget domains that came off the page
  const live = new Set(targets.map((t) => t.domain))
  for (const d of lastCheck.keys()) if (!live.has(d)) lastCheck.delete(d)
}
