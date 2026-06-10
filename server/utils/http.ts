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
