import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DAY, certThresholds, certLevel, daysLeft, nextCheckIn, certLeftText, certAlertStep, inheritedState, type CertInfo } from '../shared/utils/certs.ts'
import { silencedState } from '../shared/utils/silence.ts'

const NOW = 1_800_000_000_000
const cert = (lifeDays: number, leftMs: number, over: Partial<CertInfo> = {}): CertInfo => ({
  notBefore: NOW + leftMs - lifeDays * DAY,
  notAfter: NOW + leftMs,
  names: ['app.example.com'],
  fingerprint: 'AA:BB',
  trusted: true,
  ...over,
})

test('certs: thresholds scale with lifetime, so a healthy short-lived cert never warns', () => {
  assert.deepEqual(certThresholds(cert(90, 0)), { warn: 14 * DAY, critical: 7 * DAY })
  const short = certThresholds(cert(45, 0))
  assert.equal(short.warn, 14 * DAY) // a third of 45 days is 15, so 14 still applies
  const sixDays = certThresholds(cert(6, 0)) // e.g. short-lived ACME profiles
  assert.equal(sixDays.warn, 2 * DAY)
  assert.equal(sixDays.critical, 1 * DAY)
  // a 45-day cert renewed at two thirds of its life has 15 days left: still ok
  assert.equal(certLevel(cert(45, 15 * DAY), NOW), 'ok')
})

test('certs: levels at the edges, counted in milliseconds (the last day is critical, not ok)', () => {
  assert.equal(certLevel(cert(90, 14 * DAY + 1), NOW), 'ok')
  assert.equal(certLevel(cert(90, 14 * DAY), NOW), 'warn')
  assert.equal(certLevel(cert(90, 7 * DAY), NOW), 'critical')
  assert.equal(certLevel(cert(90, 3600_000), NOW), 'critical')
  assert.equal(certLevel(cert(90, 0), NOW), 'expired')
  assert.equal(daysLeft(cert(90, 3600_000), NOW), 0)
  assert.equal(certLeftText(cert(90, 3600_000), NOW), 'expires today')
  assert.equal(certLeftText(cert(90, -3 * DAY), NOW), 'expired 3 days ago')
  assert.equal(certLeftText(cert(90, 23 * DAY + 5), NOW), '23 days left')
})

test('certs: check daily, hourly near the end or after a failure', () => {
  assert.equal(nextCheckIn(cert(90, 30 * DAY), false, NOW), DAY)
  assert.equal(nextCheckIn(cert(90, DAY), false, NOW), 3600_000)
  assert.equal(nextCheckIn(null, true, NOW), 3600_000)
})

test('certs: each tier is announced once, a higher one replaces it', () => {
  let s = certAlertStep(undefined, cert(90, 30 * DAY), NOW)
  assert.equal(s.emit, null)
  s = certAlertStep(s.next, cert(90, 13 * DAY), NOW)
  assert.deepEqual(s.emit, { kind: 'cert-expiring', tier: 'warn' })
  s = certAlertStep(s.next, cert(90, 12 * DAY), NOW)
  assert.equal(s.emit, null) // same tier: not again every day
  s = certAlertStep(s.next, cert(90, 6 * DAY), NOW)
  assert.deepEqual(s.emit, { kind: 'cert-expiring', tier: 'critical' })
  s = certAlertStep(s.next, cert(90, -1), NOW)
  assert.deepEqual(s.emit, { kind: 'cert-expiring', tier: 'expired' })
})

test('certs: a trust problem is announced when a trusted cert turns untrusted, not for a self-signed one', () => {
  const selfSigned = cert(365, 200 * DAY, { trusted: false, error: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
  assert.equal(certAlertStep(undefined, selfSigned, NOW).emit, null)
  assert.equal(certAlertStep({ notified: null, trusted: false }, selfSigned, NOW).emit, null)
  // the proxy fell back to its default certificate (wrong name). It has a new
  // fingerprint, so it has no state of its own: it starts from the one it replaced.
  const fallback = cert(365, 200 * DAY, { trusted: false, error: 'ERR_TLS_CERT_ALTNAME_INVALID' })
  assert.equal(certAlertStep(undefined, fallback, NOW).emit, null) // no history: no way to tell
  const seeded = inheritedState([{ notified: 'warn', trusted: true }])
  assert.deepEqual(seeded, { notified: null, trusted: true }) // trust carries over, tiers start fresh
  assert.deepEqual(certAlertStep(seeded, fallback, NOW).emit, { kind: 'cert-invalid' })
  assert.equal(certAlertStep(inheritedState([{ notified: null, trusted: false }]), fallback, NOW).emit, null) // was never trusted
  assert.equal(inheritedState([undefined]), undefined)
  // an expired cert is the expiry alert's job, not a second trust alert
  const expired = cert(90, -1, { trusted: false, error: 'CERT_HAS_EXPIRED' })
  assert.deepEqual(certAlertStep({ notified: 'critical', trusted: true }, expired, NOW).emit, { kind: 'cert-expiring', tier: 'expired' })
})

test('silence: a silenced state remembers a down alert that already went out', () => {
  const empty: { consecutiveBad: number; firing: boolean; firedAt: number; lastNotifiedAt: number; heldOpen?: boolean } = { consecutiveBad: 0, firing: false, firedAt: 0, lastNotifiedAt: 0 }
  assert.equal(silencedState({ ...empty, firing: true }, empty).heldOpen, true)
  assert.equal(silencedState({ ...empty, heldOpen: true }, empty).heldOpen, true) // still owed after a second silence
  assert.equal(silencedState(undefined, empty).heldOpen, false)
  assert.equal(silencedState({ ...empty, firing: true }, empty).firing, false) // reset, not muted
})
