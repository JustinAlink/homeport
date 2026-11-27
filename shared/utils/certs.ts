// TLS certificate expiry: levels, when to check, and when to say something. Pure,
// shared by the server checks, the UI chips and the unit tests.
//
// Thresholds scale with the certificate's lifetime. Let's Encrypt's default goes to
// 64 days in February 2027 and 45 in February 2028, renewing about two thirds of the
// way through; a fixed 21-day warning would then fire for every healthy certificate.
// So: warn at 14 days or a third of the lifetime, whichever is shorter; critical at
// 7 days or a sixth.

export const DAY = 86_400_000

export interface CertInfo {
  notBefore: number
  notAfter: number
  issuer?: string
  /** the names it covers (subjectAltName DNS entries) */
  names: string[]
  /** SHA-256 fingerprint: identifies the certificate across the domains it covers */
  fingerprint: string
  /** would a normal client trust it (chain, dates, name)? */
  trusted: boolean
  /** Node's reason when it isn't, e.g. DEPTH_ZERO_SELF_SIGNED_CERT */
  error?: string
}

export type CertLevel = 'expired' | 'critical' | 'warn' | 'ok'

export function certThresholds(c: Pick<CertInfo, 'notBefore' | 'notAfter'>): { warn: number; critical: number } {
  const life = Math.max(DAY, c.notAfter - c.notBefore)
  return { warn: Math.min(14 * DAY, life / 3), critical: Math.min(7 * DAY, life / 6) }
}

/** Work in milliseconds: on the last day "0 days left" must still count as critical. */
export function certLevel(c: Pick<CertInfo, 'notBefore' | 'notAfter'>, now: number): CertLevel {
  const left = c.notAfter - now
  if (left <= 0) return 'expired'
  const t = certThresholds(c)
  if (left <= t.critical) return 'critical'
  if (left <= t.warn) return 'warn'
  return 'ok'
}

/** Whole days left, rounded down; negative once expired. */
export const daysLeft = (c: Pick<CertInfo, 'notAfter'>, now: number) => Math.floor((c.notAfter - now) / DAY)

/** When to look again: daily, hourly after a failed check or in the last two days. */
export function nextCheckIn(c: Pick<CertInfo, 'notAfter'> | null, failed: boolean, now: number): number {
  if (failed || !c) return 3600_000
  return c.notAfter - now < 2 * DAY ? 3600_000 : DAY
}

/** Plain words for a chip: "23 days", "2 days", "today", "expired 3 days ago". */
export function certLeftText(c: Pick<CertInfo, 'notAfter'>, now: number): string {
  const d = daysLeft(c, now)
  if (c.notAfter <= now) return d <= -1 ? `expired ${-d} day${d === -1 ? '' : 's'} ago` : 'expired'
  if (d === 0) return 'expires today'
  return `${d} day${d === 1 ? '' : 's'} left`
}

export interface CertAlertState {
  /** the highest tier announced for this certificate */
  notified: 'warn' | 'critical' | 'expired' | null
  trusted: boolean
}

const TIER_RANK = { warn: 1, critical: 2, expired: 3 } as const

/**
 * One certificate's next alert, if any. Each tier is announced once (a higher one
 * replaces the lower), so a cert that keeps getting closer is not re-announced every
 * check. A trust problem is announced only when a certificate that was trusted stops
 * being trusted: the moment a proxy falls back to its default certificate, not every
 * check of an internal self-signed one.
 */
export function certAlertStep(
  prev: CertAlertState | undefined,
  c: CertInfo,
  now: number,
): { next: CertAlertState; emit: { kind: 'cert-expiring'; tier: 'warn' | 'critical' | 'expired' } | { kind: 'cert-invalid' } | null } {
  const level = certLevel(c, now)
  const trustBroke = !!prev && prev.trusted && !c.trusted && c.error !== 'CERT_HAS_EXPIRED'
  const notified = prev?.notified ?? null
  if (trustBroke) return { next: { notified, trusted: c.trusted }, emit: { kind: 'cert-invalid' } }
  if (level !== 'ok' && (!notified || TIER_RANK[level] > TIER_RANK[notified])) {
    return { next: { notified: level, trusted: c.trusted }, emit: { kind: 'cert-expiring', tier: level } }
  }
  return { next: { notified: level === 'ok' ? null : notified, trusted: c.trusted }, emit: null }
}

/**
 * The state a certificate starts from when it replaced others on the same domains.
 * A proxy falling back to its default certificate serves one with a new
 * fingerprint, so the new certificate has no history of its own: it inherits the
 * old ones' trust (so "was trusted, now isn't" can still be told), and starts with
 * no tier announced (it is a different certificate, with its own expiry).
 */
export function inheritedState(replaced: (CertAlertState | undefined)[]): CertAlertState | undefined {
  const known = replaced.filter((s): s is CertAlertState => !!s)
  if (!known.length) return undefined
  return { notified: null, trusted: known.some((s) => s.trusted) }
}
