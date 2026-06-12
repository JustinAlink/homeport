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
            error: status >= 400 ? `HTTP ${status}` : status === 0 ? 'no response' : undefined,
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, ok: false, data: null, text: '', error: 'timeout' })
    })
    req.on('error', (e) => resolve({ status: 0, ok: false, data: null, text: '', error: e.message }))
    if (payload) req.write(payload)
    req.end()
  })
}
