import http from 'node:http'
import https from 'node:https'
import type { PingResult } from '~/types/service'

/**
 * Reachability check: any HTTP response = reachable (we record the code); a
 * connection error / timeout = down (status 0). Lenient on TLS (self-signed ok)
 * and doesn't follow redirects (a 3xx still means "up").
 */
export function pingUrl(url: string, timeoutMs = 6000): Promise<PingResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return resolve({ status: 0, ms: 0 })
    }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      u,
      { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false, headers: { 'user-agent': 'homeport' } },
      (res) => {
        res.resume() // drain
        resolve({ status: res.statusCode || 0, ms: Date.now() - start })
      },
    )
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

/** Ping many URLs (bounded concurrency, TTL-cached). Returns a map keyed by url. */
export async function pingAll(urls: string[], now: number): Promise<Record<string, PingResult>> {
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
      const result = await pingUrl(url)
      cache.set(url, { result, at: now })
      out[url] = result
    }
  }
  await Promise.all(Array.from({ length: Math.min(10, queue.length || 1) }, worker))
  return out
}
