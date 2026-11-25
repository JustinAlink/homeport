import { test } from 'node:test'
import assert from 'node:assert/strict'
import { healthOf, staleAfterMs, startupGraceMs } from '../server/utils/health-core.ts'

const I = 30_000 // default collector interval
const T0 = 1_700_000_000_000

test('health: fresh snapshot with a reachable host is ok', () => {
  assert.deepEqual(healthOf({ at: T0, hostsOnline: { default: true } }, T0 + I, I, T0 - 3600_000), {
    ok: true,
    status: 'ok',
  })
})

test('health: every host offline is docker-unreachable (the blind-homeport case)', () => {
  const v = healthOf({ at: T0, hostsOnline: { default: false } }, T0 + 1000, I, T0 - 3600_000)
  assert.deepEqual(v, { ok: false, status: 'docker-unreachable' })
})

test('health: one host of several offline is still ok', () => {
  const v = healthOf({ at: T0, hostsOnline: { local: true, nas: false } }, T0 + 1000, I, T0 - 3600_000)
  assert.equal(v.ok, true)
})

test('health: no hosts at all counts as unreachable, never as ok', () => {
  assert.equal(healthOf({ at: T0, hostsOnline: {} }, T0, I, T0 - 3600_000).ok, false)
})

test('health: before the first snapshot it is starting, then stalled after the grace', () => {
  const boot = T0
  assert.deepEqual(healthOf(null, boot + 5_000, I, boot), { ok: true, status: 'starting' })
  assert.deepEqual(healthOf(null, boot + startupGraceMs(I) + 1, I, boot), { ok: false, status: 'collector-stalled' })
})

test('health: a snapshot older than the stale window is collector-stalled, even with hosts online', () => {
  const snap = { at: T0, hostsOnline: { default: true } }
  assert.equal(healthOf(snap, T0 + staleAfterMs(I), I, T0 - 3600_000).ok, true) // boundary still ok
  assert.deepEqual(healthOf(snap, T0 + staleAfterMs(I) + 1, I, T0 - 3600_000), { ok: false, status: 'collector-stalled' })
})

test('health: a few slow ticks do not read as stalled, ten minutes without one does', () => {
  const snap = { at: T0, hostsOnline: { default: true } }
  assert.equal(healthOf(snap, T0 + 5 * 60_000, I, T0 - 3600_000).ok, true)
  assert.equal(healthOf(snap, T0 + 11 * 60_000, I, T0 - 3600_000).ok, false)
})
