import http from 'node:http'
import https from 'node:https'

export interface PostResult {
  status: number // HTTP status, or 0 = no response
  ok: boolean
  error?: string
}

/**
 * POST a body to a URL (node http/https, lenient TLS, no redirects). Mirrors the
 * style of ping.ts's pingUrl. Used for outbound webhook notifications.
 */
export function postJson(
  url: string,
  body: string,
  headers: Record<string, string> = {},
  timeoutMs = 8000,
): Promise<PostResult> {
  return new Promise((resolve) => {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return resolve({ status: 0, ok: false, error: 'invalid url' })
    }
    const lib = u.protocol === 'https:' ? https : http
    const payload = Buffer.from(body, 'utf8')
    const req = lib.request(
      u,
      {
        method: 'POST',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          'content-type': 'application/json',
          'content-length': String(payload.length),
          'user-agent': 'homeport',
          ...headers,
        },
      },
      (res) => {
        res.resume() // drain
        const status = res.statusCode || 0
        resolve({ status, ok: status >= 200 && status < 300, error: status >= 400 ? `HTTP ${status}` : undefined })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, ok: false, error: 'timeout' })
    })
    req.on('error', (e) => resolve({ status: 0, ok: false, error: e.message }))
    req.write(payload)
    req.end()
  })
}

export interface JsonResponse<T = any> {
  status: number // 0 = no response
  ok: boolean
  data: T | null
  text: string
  error?: string
}

/**
 * Generic JSON request (GET/POST/PUT/PATCH/DELETE), lenient TLS, no redirects.
 * Parses the response body as JSON when possible. Used by the proxy-admin layer
 * (NPM REST + Caddy admin API).
 */
export function httpJson<T = any>(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<JsonResponse<T>> {
  return new Promise((resolve) => {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return resolve({ status: 0, ok: false, data: null, text: '', error: 'invalid url' })
    }
    const lib = u.protocol === 'https:' ? https : http
    const payload = opts.body !== undefined ? Buffer.from(opts.body, 'utf8') : null
    const req = lib.request(
      u,
      {
        method: opts.method || 'GET',
        timeout: opts.timeoutMs ?? 8000,
        rejectUnauthorized: false,
        headers: {
          accept: 'application/json',
          'user-agent': 'homeport',
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode || 0
          let data: T | null = null
          try {
            data = text ? JSON.parse(text) : null
          } catch {
            data = null
          }
          resolve({
            status,
            ok: status >= 200 && status < 300,
            data,
            text,
            // Keep the upstream reason — NPM/Caddy return a real message in the
            // body; discarding it is why proxy errors read as a bare "HTTP 401".
            error: status >= 400 ? `HTTP ${status}${bodyReason(data, text)}` : status === 0 ? 'no response' : undefined,
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, ok: false, data: null, text: '', error: `no response (timed out after ${opts.timeoutMs ?? 8000}ms)` })
    })
    req.on('error', (e) => resolve({ status: 0, ok: false, data: null, text: '', error: connError(e, u) }))
    if (payload) req.write(payload)
    req.end()
  })
}

/** A short, human reason from a 4xx/5xx body — the JSON message field, else a trimmed snippet. */
function bodyReason(data: any, text: string): string {
  const msg =
    (data && (data.message || data.error || data.detail || (Array.isArray(data.errors) && data.errors[0]?.message))) ||
    ''
  const reason = String(msg || text || '').replace(/\s+/g, ' ').trim()
  return reason ? ` — ${reason.slice(0, 160)}` : ''
}

/** Turn a low-level socket error into something a user can act on. */
function connError(e: NodeJS.ErrnoException, u: URL): string {
  if (e.code === 'ECONNREFUSED') return `connection refused at ${u.host} — is the proxy reachable from homeport?`
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return `host not found: ${u.host}`
  if (e.code === 'ECONNRESET') return `connection reset by ${u.host}`
  return e.message
}
