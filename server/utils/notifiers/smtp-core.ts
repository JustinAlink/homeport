// Pure SMTP building blocks (no I/O) — unit-testable in isolation. The tiny
// client in email.ts drives a socket with these.

/** Fold an SMTP reply into { code, done } — replies can span lines ("250-…\r\n250 …"). */
export function parseReply(buffer: string): { code: number; done: boolean; text: string } | null {
  if (!buffer.includes('\r\n')) return null
  const lines = buffer.split('\r\n').filter(Boolean)
  const last = lines[lines.length - 1]
  const m = /^(\d{3})([ -])/.exec(last)
  if (!m) return null
  if (m[2] === '-') return null // still mid multi-line reply
  return { code: Number(m[1]), done: true, text: lines.join(' ') }
}

/** RFC 4616 AUTH PLAIN initial response. */
export function authPlain(user: string, pass: string): string {
  return Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64')
}

/** Very small header sanitizer — no CR/LF injection through names/subjects. */
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

/** Encode a header value as RFC 2047 UTF-8 base64 when it isn't plain ASCII. */
export function encodeHeader(value: string): string {
  const v = clean(value)
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?utf-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`
}

/**
 * Build the DATA payload: minimal headers + a plain-text UTF-8 body, CRLF line
 * endings, leading dots stuffed (RFC 5321 §4.5.2), terminated by the caller.
 */
export function buildMessage(opts: { from: string; to: string[]; subject: string; text: string; date?: string }): string {
  const headers = [
    `From: ${clean(opts.from)}`,
    `To: ${opts.to.map(clean).join(', ')}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    `Date: ${opts.date ?? new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ]
  const body = opts.text.replace(/\r?\n/g, '\r\n')
  const raw = headers.join('\r\n') + '\r\n\r\n' + body
  return raw.replace(/(^|\r\n)\./g, '$1..')
}

/** Split "a@x, b@y" into clean addresses. */
export function splitAddresses(to: string): string[] {
  return to.split(/[,;]/).map((a) => a.trim()).filter(Boolean)
}
