import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inWindow, silencedBy, pruneSilences, validWindow, serviceKey, emptySilences, type MaintenanceWindow } from '../shared/utils/silence.ts'

const at = (day: number, hhmm: string) => ({ day, minute: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) })
const nightly: MaintenanceWindow = { id: 'w1', days: [1, 2, 3, 4, 5], start: '02:00', end: '04:00', note: 'backups' }
const overnight: MaintenanceWindow = { id: 'w2', days: [6], start: '23:00', end: '01:00' }

test('inWindow: inside, at the edges, and on other days', () => {
  assert.equal(inWindow(nightly, at(1, '02:00')), true) // start is inclusive
  assert.equal(inWindow(nightly, at(1, '03:59')), true)
  assert.equal(inWindow(nightly, at(1, '04:00')), false) // end is exclusive
  assert.equal(inWindow(nightly, at(0, '03:00')), false) // Sunday not listed
})

test('inWindow: a window past midnight belongs to the day it started', () => {
  assert.equal(inWindow(overnight, at(6, '23:30')), true) // Saturday night
  assert.equal(inWindow(overnight, at(0, '00:30')), true) // early Sunday, still Saturday's window
  assert.equal(inWindow(overnight, at(0, '23:30')), false) // Sunday night is not listed
  assert.equal(inWindow(overnight, at(6, '00:30')), false) // early Saturday belongs to Friday
})

test('silencedBy: pause beats windows beats a snooze; ended ones do not count', () => {
  const now = 1_000_000
  const s = { snoozes: { 'h|web': { until: now + 60_000, at: now } }, pausedUntil: 0 }
  assert.equal(silencedBy('h|web', now, at(0, '12:00'), s, [])?.kind, 'snooze')
  assert.equal(silencedBy('h|db', now, at(0, '12:00'), s, []), null) // another app
  assert.equal(silencedBy('h|web', now + 60_000, at(0, '12:00'), s, []), null) // snooze ended
  assert.equal(silencedBy('h|db', now, at(1, '03:00'), s, [nightly])?.kind, 'window')
  assert.equal(silencedBy(null, now, at(0, '12:00'), { ...s, pausedUntil: now + 1 }, [])?.kind, 'pause') // host alerts too
  assert.equal(silencedBy(null, now, at(0, '12:00'), s, []), null) // a snooze never covers host alerts
})

test('pruneSilences: ended snoozes and an ended pause go', () => {
  const now = 5000
  const pruned = pruneSilences({ snoozes: { a: { until: 4000, at: 0 }, b: { until: 6000, at: 0 } }, pausedUntil: 4000, pauseNote: 'old' }, now)
  assert.deepEqual(Object.keys(pruned.snoozes), ['b'])
  assert.equal(pruned.pausedUntil, 0)
  assert.equal(pruned.pauseNote, undefined)
  assert.deepEqual(pruneSilences(emptySilences(), now), emptySilences())
})

test('validWindow: rejects empty days, bad times and zero-length windows', () => {
  assert.equal(validWindow(nightly), true)
  assert.equal(validWindow({ ...nightly, days: [] }), false)
  assert.equal(validWindow({ ...nightly, days: [7] }), false)
  assert.equal(validWindow({ ...nightly, start: '24:00' }), false)
  assert.equal(validWindow({ ...nightly, end: '02:00' }), false)
})

test('serviceKey: stable across recreates, default host for bare ids', () => {
  assert.equal(serviceKey('vps::abc123', 'web'), 'vps|web')
  assert.equal(serviceKey('demo-3', 'ghost'), 'default|ghost')
})
