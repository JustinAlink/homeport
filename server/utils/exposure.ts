import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Service } from '~/types/service'
import { exposureOf, exposureInput, sortExposure, exposureSummary, ackKey, FINDING_CODES, type DomainProbe, type ServiceExposure, type ExposureLevel, type ExposureAck } from '../../shared/utils/exposure.ts'
import { buildServices } from './compose'
import { getConfig } from './config'
import { getHosts } from './hosts'
import { pingWithFallback } from './ping'
import { findProxyName, localDomainUrls, PROXY_IMAGES, imageRepoOf } from './ping-core'

// The exposure report: the shared rules (shared/utils/exposure.ts) applied to the
// live fleet, plus what an anonymous visitor gets from each domain. Probes go
// through the same proxy fallback as the domain checks, since many servers can't
// reach their own public address from inside Docker.

const TTL = 60_000
const cache = new Map<string, { at: number; probe: DomainProbe }>()

async function probe(url: string, https: boolean, proxy: string | null, now: number): Promise<DomainProbe> {
  const hit = cache.get(url)
  if (hit && now - hit.at < TTL) return hit.probe
  // shorter than the dashboard's checks: a page waits on these
  const main = await pingWithFallback(url, proxy, now, 4000)
  const out: DomainProbe = { status: main.status, ...(main.location ? { location: main.location } : {}) }
  if (https && main.status) {
    const h = await pingWithFallback(url.replace(/^https:/i, 'http:'), proxy, now, 4000)
    out.http = { status: h.status, ...(h.location ? { location: h.location } : {}) }
  }
  cache.set(url, { at: now, probe: out })
  return out
}

/** Probe every route of these services (bounded concurrency, cached a minute). */
async function probeAll(services: Service[], now: number): Promise<Record<string, DomainProbe>> {
  const localHost = getHosts()[0]?.name
  const proxy = findProxyName(services, localHost)
  const local = localDomainUrls(services, localHost)
  const queue = [...new Map(services.flatMap((s) => s.domains.map((d) => [d.url, d.ssl] as const))).entries()]
  const out: Record<string, DomainProbe> = {}
  async function worker() {
    while (queue.length) {
      const [url, ssl] = queue.shift()!
      out[url] = await probe(url, ssl, local.has(url) ? proxy : null, now)
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, queue.length || 1) }, worker))
  return out
}

const isProxyImage = (image: string) => PROXY_IMAGES.includes(imageRepoOf(image))

/** Exposure of running containers; probes only when asked (they take a moment) and domain checks are on. */
export async function getExposure(opts: { probe: boolean; id?: string }): Promise<{
  services: ServiceExposure[]
  summary: Record<ExposureLevel, number>
  probed: boolean
  pingEnabled: boolean
  at: number
}> {
  const cfg = getConfig()
  const now = Date.now()
  const all = (await buildServices()).services.filter((s) => s.kind === 'container' && s.state === 'running')
  const services = opts.id ? all.filter((s) => s.id === opts.id) : all
  const doProbe = opts.probe && cfg.pingEnabled
  const probes = doProbe ? await probeAll(services, now) : {}
  const acks = readAcks()
  const list = sortExposure(services.map((s) => exposureOf(exposureInput(s, isProxyImage(s.image)), probes, acks)))
  return { services: list, summary: exposureSummary(list), probed: doProbe, pingEnabled: cfg.pingEnabled, at: now }
}

// ---- accepted findings ----
// A finding the admin marked as intended ("LAN clients need 32400"), with the
// reason, in <data>/exposure.json. Keyed by container name and rule, so it
// survives a recreate and a new kind of problem on the same container still shows.

const acksFile = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'exposure.json')
let acksCache: Record<string, ExposureAck> | null = null

export function readAcks(): Record<string, ExposureAck> {
  if (acksCache) return acksCache
  try {
    const parsed = JSON.parse(readFileSync(acksFile(), 'utf8'))
    acksCache = parsed && typeof parsed.acks === 'object' && parsed.acks ? parsed.acks : {}
  } catch {
    acksCache = {} // none yet, or unreadable: nothing accepted
  }
  return acksCache!
}

/** Accept a finding (note) or take the acceptance back (note null). Throws on bad input or an unwritable data dir. */
export function setAck(key: string, code: string, note: string | null): Record<string, ExposureAck> {
  if (!/^[\w.-]{1,64}\|[\w.-]{1,128}$/.test(key)) throw Object.assign(new Error('invalid container key'), { statusCode: 400 })
  if (!FINDING_CODES.includes(code)) throw Object.assign(new Error('unknown finding'), { statusCode: 400 })
  const next = { ...readAcks() }
  const k = ackKey(key, code)
  if (note === null) delete next[k]
  else {
    const text = note.trim().slice(0, 200)
    if (!text) throw Object.assign(new Error('say why this is fine, so the next look at it makes sense'), { statusCode: 400 })
    next[k] = { note: text, at: Date.now() }
  }
  const dir = process.env.HOMEPORT_DATA_DIR || '/data'
  mkdirSync(dir, { recursive: true })
  const tmp = `${acksFile()}.tmp`
  writeFileSync(tmp, JSON.stringify({ acks: next }, null, 2))
  renameSync(tmp, acksFile())
  acksCache = next
  return next
}
