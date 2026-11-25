import http from 'node:http'
import https from 'node:https'
import type { TLSSocket } from 'node:tls'
import type { PingCert, PingResult } from '~/types/service'
import { routeOrder } from './ping-core'

/**
 * Reachability check: any HTTP response = reachable (we record the code); a
 * connection error / timeout = down (status 0). Lenient on TLS (self-signed ok)
 * and doesn't follow redirects (a 3xx still means "up").
 *
 * `via` sends the request to another host (the reverse-proxy container) while
 * keeping the domain as Host header and TLS server name, so the proxy serves the
 * same route it would for a visitor (see ping-core.ts for why).
 */
export function pingUrl(url: string, timeoutMs = 6000, via?: { host: string; port?: number }): Promise<PingResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return resolve({ status: 0, ms: 0 })
    }
    const isHttps = u.protocol === 'https:'
    const lib = isHttps ? https : http
    const opts = { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false, headers: { 'user-agent': 'homeport' } as Record<string, string> }
    const onResponse = (res: http.IncomingMessage) => {
      const status = res.statusCode || 0
      const location = status >= 300 && status < 400 && typeof res.headers.location === 'string' ? res.headers.location : undefined
      // The handshake already happened, so the certificate costs nothing extra. Read
      // before draining: a closed socket has nothing left to tell.
      const cert = isHttps ? certOf(res.socket as TLSSocket) : undefined
      res.resume() // drain
      resolve({ status, ms: Date.now() - start, ...(location ? { location } : {}), ...(cert ? { cert } : {}) })
    }
    // one options object for the proxy route (a URL can't carry another host's address)
    const req = via
      ? lib.request(
          {
            ...opts,
            host: via.host,
            port: via.port ?? (u.port ? Number(u.port) : isHttps ? 443 : 80),
            path: `${u.pathname}${u.search}`,
            headers: { ...opts.headers, host: u.host },
            ...(isHttps ? { servername: u.hostname } : {}),
          },
          onResponse,
        )
      : lib.request(u, opts, onResponse)
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, ms: Date.now() - start })
    })
    req.on('error', () => resolve({ status: 0, ms: Date.now() - start }))
    req.end()
  })
}

/** The peer certificate of a TLS answer, with whether a strict client would accept it. */
function certOf(sock: TLSSocket | null | undefined): PingCert | undefined {
  try {
    const c = sock?.getPeerCertificate?.()
    if (!c || !c.valid_to) return undefined
    const notAfter = Date.parse(c.valid_to)
    if (!Number.isFinite(notAfter)) return undefined
    const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined
    const issuer = pick(c.issuer?.O) || pick(c.issuer?.CN)
    // rejectUnauthorized is off (self-signed apps still count as up), but the socket
    // still records what verification would have said
    const err = sock?.authorized ? undefined : String(sock?.authorizationError ?? '') || undefined
    return { notAfter, ...(issuer ? { issuer } : {}), trusted: !!sock?.authorized, ...(err ? { error: err } : {}) }
  } catch {
    return undefined // a certificate we can't read is no reason to fail the check
  }
}

// Per-URL cache so frequent polls don't re-hit every target.
const cache = new Map<string, { result: PingResult; at: number }>()
const TTL = 20_000
// URLs whose public route just failed while the proxy answered: go to the proxy
// first for a while instead of waiting out the public timeout on every poll
const publicDown = new Map<string, number>()
const PUBLIC_RETRY_MS = 10 * 60_000

/** Public route first, then (when known) straight through the proxy container. */
export async function pingWithFallback(url: string, proxyHost: string | null, now: number, timeoutMs = 6000): Promise<PingResult> {
  let last: PingResult = { status: 0, ms: 0 }
  for (const route of routeOrder(publicDown.get(url), now, !!proxyHost)) {
    const r = route === 'proxy' ? await pingUrl(url, timeoutMs, { host: proxyHost! }) : await pingUrl(url, timeoutMs)
    if (r.status) {
      if (route === 'proxy') publicDown.set(url, now + PUBLIC_RETRY_MS)
      else publicDown.delete(url)
      return route === 'proxy' ? { ...r, via: 'proxy' } : r
    }
    last = r
  }
  return last
}

/**
 * Ping many URLs (bounded concurrency, TTL-cached). Returns a map keyed by url.
 * `proxyHost`: the reverse proxy's container name, for the fallback route.
 */
/** proxyHost: the proxy container to fall back to, for every URL or per URL (null = public route only). */
export async function pingAll(
  urls: string[],
  now: number,
  proxyHost: string | null | ((url: string) => string | null) = null,
): Promise<Record<string, PingResult>> {
  const out: Record<string, PingResult> = {}
  const todo: string[] = []
  for (const url of urls) {
    const c = cache.get(url)
    if (c && now - c.at < TTL) out[url] = c.result
    else todo.push(url)
  }

  const queue = [...new Set(todo)]
  async function worker() {
    while (queue.length) {
      const url = queue.shift()!
      const result = await pingWithFallback(url, typeof proxyHost === 'function' ? proxyHost(url) : proxyHost, now)
      cache.set(url, { result, at: now })
      out[url] = result
    }
  }
  await Promise.all(Array.from({ length: Math.min(10, queue.length || 1) }, worker))
  return out
}
