import type { H3Event } from 'h3'

// The client address every rate limiter keys on. X-Forwarded-For is only
// trustworthy when a proxy WE control sets it: a directly-exposed instance lets
// any client forge it, defeating per-IP limits. Trust it only on explicit
// opt-in; otherwise key on the real socket address. One place, so the auth
// endpoints can't drift apart on this.
const trustProxy = process.env.HOMEPORT_TRUSTED_PROXY === 'true' || process.env.HOMEPORT_TRUSTED_PROXY === '1'

export function clientIp(event: H3Event): string {
  return (trustProxy ? getRequestIP(event, { xForwardedFor: true }) : getRequestIP(event)) || 'unknown'
}
