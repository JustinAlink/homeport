import http from 'node:http'
import https from 'node:https'
import type { PingResult } from '~/types/service'
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
      res.resume() // drain
      resolve({ status: res.statusCode || 0, ms: Date.now() - start })
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

// Per-URL cache so frequent polls don't re-hit every target.
const cache = new Map<string, { result: PingResult; at: number }>()
const TTL = 20_000
// URLs whose public route just failed while the proxy answered: go to the proxy
// first for a while instead of waiting out the public timeout on every poll
const publicDown = new Map<string, number>()
const PUBLIC_RETRY_MS = 10 * 60_000

/** Public route first, then (when known) straight through the proxy container. */
async function pingWithFallback(url: string, proxyHost: string | null, now: number): Promise<PingResult> {
  let last: PingResult = { status: 0, ms: 0 }
  for (const route of routeOrder(publicDown.get(url), now, !!proxyHost)) {
    const r = route === 'proxy' ? await pingUrl(url, 6000, { host: proxyHost! }) : await pingUrl(url)
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
export async function pingAll(urls: string[], now: number, proxyHost: string | null = null): Promise<Record<string, PingResult>> {
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
      const result = await pingWithFallback(url, proxyHost, now)
      cache.set(url, { result, at: now })
      out[url] = result
    }
  }
  await Promise.all(Array.from({ length: Math.min(10, queue.length || 1) }, worker))
  return out
}
