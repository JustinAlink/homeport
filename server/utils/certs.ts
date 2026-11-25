import tls from 'node:tls'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Service } from '~/types/service'
import { certAlertStep, certLeftText, nextCheckIn, certLevel, type CertAlertState, type CertInfo } from '../../shared/utils/certs.ts'
import { serviceKey } from '../../shared/utils/silence.ts'
import { getConfig } from './config'
import { getHosts } from './hosts'
import { findProxyName, localDomainUrls } from './ping-core'
import { guard } from './guard'
import { dispatch } from './alerts'
import { silenceFor } from './silences'

// TLS certificate checks for every HTTPS domain homeport knows. Each check is its own
// fresh TLS connection, never a reused one: a kept-alive socket or a resumed session
// would keep reporting the old certificate after a renewal. Same route as the domain
// checks (public address, then the proxy container with the domain as TLS name: SNI
// is what makes the proxy serve that site's certificate instead of its default).

const file = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'certs.json')

interface Entry {
  url: string
  domain: string
  /** stable key of the app serving it, for snoozes */
  owner: string
  host?: string
  cert?: CertInfo
  checkedAt: number
  failed?: string
}

interface Store {
  entries: Record<string, Entry>
  /** alert state per certificate fingerprint, so a wildcard covering 12 domains alerts once */
  alerts: Record<string, CertAlertState>
}

let cache: Store | null = null
function load(): Store {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8'))
    cache = { entries: raw?.entries ?? {}, alerts: raw?.alerts ?? {} }
  } catch {
    cache = { entries: {}, alerts: {} }
  }
  return cache!
}
function persist() {
  try {
    mkdirSync(process.env.HOMEPORT_DATA_DIR || '/data', { recursive: true })
    const tmp = `${file()}.tmp`
    writeFileSync(tmp, JSON.stringify(cache))
    renameSync(tmp, file())
  } catch {
    // best-effort: certificates are checked again anyway
  }
}

/** One TLS handshake, nothing else: the certificate and whether a strict client would trust it. */
export function readCert(host: string, servername: string, port = 443, timeoutMs = 6000): Promise<CertInfo> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] })
    const done = (fn: () => void) => {
      sock.removeAllListeners()
      sock.destroy()
      fn()
    }
    sock.setTimeout(timeoutMs, () => done(() => reject(new Error('timed out'))))
    sock.once('error', (e) => done(() => reject(e)))
    sock.once('secureConnect', () => {
      const c = sock.getPeerCertificate()
      if (!c || !c.valid_to) return done(() => reject(new Error('no certificate')))
      const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined
      const names = String(c.subjectaltname || '')
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.startsWith('DNS:'))
        .map((n) => n.slice(4))
      const info: CertInfo = {
        notBefore: Date.parse(c.valid_from),
        notAfter: Date.parse(c.valid_to),
        ...(pick(c.issuer?.O) || pick(c.issuer?.CN) ? { issuer: pick(c.issuer?.O) || pick(c.issuer?.CN) } : {}),
        names: names.length ? names : [pick(c.subject?.CN) || servername],
        fingerprint: c.fingerprint256 || c.fingerprint || `${servername}:${c.valid_to}`,
        trusted: sock.authorized,
        ...(sock.authorized ? {} : { error: String(sock.authorizationError || 'untrusted') }),
      }
      done(() => resolve(info))
    })
  })
}

async function check(url: string, proxy: string | null): Promise<CertInfo> {
  const u = new URL(url)
  const port = u.port ? Number(u.port) : 443
  try {
    return await readCert(u.hostname, u.hostname, port)
  } catch (e) {
    if (!proxy) throw e
    // the public address didn't answer from inside Docker (no NAT loopback, a
    // firewall): ask the proxy container for the same name instead
    return await readCert(proxy, u.hostname, 443)
  }
}

/** HTTPS domains of running containers, with the app that serves each. */
function targets(services: Service[]) {
  const out = new Map<string, { url: string; domain: string; owner: string; host?: string; local: boolean }>()
  const localHost = getHosts()[0]?.name
  const local = localDomainUrls(services, localHost)
  for (const s of services) {
    if (s.kind !== 'container' || s.state !== 'running' || s.noalert) continue
    for (const d of s.domains) {
      if (!d.ssl || out.has(d.url)) continue
      out.set(d.url, { url: d.url, domain: d.domain, owner: serviceKey(s.id, s.name), host: s.host, local: local.has(d.url) })
    }
  }
  return [...out.values()]
}

/**
 * Check the certificates that are due (daily, hourly near expiry or after a
 * failure), then alert. Guarded: a slow host never stacks checks. Runs beside the
 * collector tick, like update checks.
 */
export const runCertChecks = guard(async (services: Service[]) => {
  const cfg = getConfig()
  if (!cfg.pingEnabled) return
  const store = load()
  const now = Date.now()
  const list = targets(services)
  const proxy = findProxyName(services, getHosts()[0]?.name)
  const due = list.filter((t) => {
    const e = store.entries[t.url]
    return !e || now - e.checkedAt >= nextCheckIn(e.cert ?? null, !!e.failed, now)
  })
  const queue = [...due]
  // domains now served a different certificate than at their last reading, by old fingerprint
  const renewed = new Map<string, Entry[]>()
  async function worker() {
    while (queue.length) {
      const t = queue.shift()!
      const prev = store.entries[t.url]
      try {
        const cert = await check(t.url, t.local ? proxy : null)
        store.entries[t.url] = { url: t.url, domain: t.domain, owner: t.owner, host: t.host, cert, checkedAt: Date.now() }
        if (prev?.cert && prev.cert.fingerprint !== cert.fingerprint) {
          renewed.set(prev.cert.fingerprint, [...(renewed.get(prev.cert.fingerprint) ?? []), store.entries[t.url]])
        }
      } catch (e: any) {
        // keep the last good reading: an unreachable domain is the domain alert's job
        store.entries[t.url] = { ...(prev ?? { url: t.url, domain: t.domain, owner: t.owner, host: t.host }), checkedAt: Date.now(), failed: String(e?.message || e) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length || 1) }, worker))
  // forget domains that are gone
  const live = new Set(list.map((t) => t.url))
  for (const k of Object.keys(store.entries)) if (!live.has(k)) delete store.entries[k]
  if (cfg.alertsEnabled && cfg.alertCerts) await alertOnCerts(store, renewed, now)
  else {
    // keep the alert state current, so turning alerts on later doesn't announce old news
    for (const g of groups(store)) store.alerts[g.fp] = certAlertStep(store.alerts[g.fp], g.cert, now).next
  }
  persist()
})

function groups(store: Store) {
  const byFp = new Map<string, { fp: string; cert: CertInfo; entries: Entry[] }>()
  for (const e of Object.values(store.entries)) {
    if (!e.cert) continue
    const g = byFp.get(e.cert.fingerprint) ?? { fp: e.cert.fingerprint, cert: e.cert, entries: [] }
    g.entries.push(e)
    byFp.set(e.cert.fingerprint, g)
  }
  return [...byFp.values()]
}

async function alertOnCerts(store: Store, renewed: Map<string, Entry[]>, now: number) {
  const current = groups(store)
  const live = new Set(current.map((g) => g.fp))
  // "renewed" only closes a warning that went out: a quiet renewal says nothing
  for (const [oldFp, entries] of renewed) {
    if (store.alerts[oldFp]?.notified && entries[0]?.cert) {
      await dispatch({ id: `cert:${oldFp}`, name: entries.map((e) => e.domain).join(', '), host: entries[0].host, kind: 'cert-renewed', from: '', to: certLeftText(entries[0].cert, now), at: now })
    }
  }
  // state of certificates no longer served anywhere
  for (const fp of Object.keys(store.alerts)) if (!live.has(fp)) delete store.alerts[fp]
  for (const g of current) {
    const { next, emit } = certAlertStep(store.alerts[g.fp], g.cert, now)
    store.alerts[g.fp] = next
    if (!emit) continue
    // silent while every app it covers is snoozed (a pause or window is handled by dispatch)
    if (g.entries.every((e) => silenceFor(e.owner, now)?.kind === 'snooze')) continue
    const names = g.entries.map((e) => e.domain).join(', ')
    if (emit.kind === 'cert-invalid') {
      await dispatch({ id: `cert:${g.fp}`, name: names, host: g.entries[0].host, kind: 'cert-invalid', from: g.cert.issuer ?? '', to: g.cert.error ?? 'untrusted', at: now })
    } else {
      const left = certLeftText(g.cert, now)
      await dispatch({ id: `cert:${g.fp}`, name: names, host: g.entries[0].host, kind: 'cert-expiring', from: g.cert.issuer ?? 'unknown issuer', to: emit.tier === 'expired' ? 'has expired' : `expires soon (${left})`, at: now })
    }
  }
}

/** What the UI shows per domain URL. */
export function certView(now = Date.now()) {
  const out: Record<string, { notAfter: number; notBefore: number; issuer?: string; names: string[]; trusted: boolean; error?: string; level: string; left: string; checkedAt: number; failed?: string }> = {}
  for (const e of Object.values(load().entries)) {
    if (!e.cert) continue
    out[e.url] = {
      notAfter: e.cert.notAfter,
      notBefore: e.cert.notBefore,
      ...(e.cert.issuer ? { issuer: e.cert.issuer } : {}),
      names: e.cert.names,
      trusted: e.cert.trusted,
      ...(e.cert.error ? { error: e.cert.error } : {}),
      level: certLevel(e.cert, now),
      left: certLeftText(e.cert, now),
      checkedAt: e.checkedAt,
      ...(e.failed ? { failed: e.failed } : {}),
    }
  }
  return out
}

/** Forget cached state (tests, settings changes). */
export function resetCertCache() {
  cache = null
}

