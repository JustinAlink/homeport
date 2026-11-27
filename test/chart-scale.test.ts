import { test } from 'node:test'
import assert from 'node:assert/strict'
import { niceScaleMax, bridgeGaps, segmentsOf } from '../utils/chartScale.ts'

test('the usage chart fits its scale to the data, on round steps, never past the cap', () => {
  assert.equal(niceScaleMax(0.6), 5) // a quiet big server
  assert.equal(niceScaleMax(4.9), 10)
  assert.equal(niceScaleMax(17), 25)
  assert.equal(niceScaleMax(70), 100)
  assert.equal(niceScaleMax(99), 100)
  assert.equal(niceScaleMax(140), 100) // CPU over 100% (several cores) still caps
  assert.equal(niceScaleMax(0), 5)
})

import { timeTicks } from '../utils/chartScale.ts'

test('time ticks sit on round local times and stay few', () => {
  const H = 3_600_000
  const DAY = 24 * H
  const now = Date.UTC(2026, 10, 25, 10, 37)
  // 24 h in CET: every 4 h on the local clock (00:00, 04:00 ... CET = 23:00, 03:00 ... UTC)
  const day = timeTicks(now - DAY, now, -60, 6)
  assert.ok(day.at.length <= 6 && day.at.length >= 4)
  assert.ok(day.at.every((t) => (t + H) % (4 * H) === 0))
  assert.equal(day.daily, false)
  // 7 days: one tick per local midnight
  const week = timeTicks(now - 7 * DAY, now, -60, 8)
  assert.equal(week.daily, true)
  assert.ok(week.at.every((t) => (t + H) % DAY === 0))
  assert.equal(week.at.length, 7)
  // 30 days on a phone-sized graph: every 5 days
  const month = timeTicks(now - 30 * DAY, now, 0, 6)
  assert.ok(month.at.length <= 6)
  assert.equal(month.at[1] - month.at[0], 5 * DAY)
  assert.deepEqual(timeTicks(now, now, 0).at, [])
})

test('graph gaps: a missed sample is bridged, a stopped stretch is a break', () => {
  const n = null
  assert.deepEqual(bridgeGaps([1, n, 3]), [1, 1, 3]) // one missed sample
  assert.deepEqual(bridgeGaps([1, n, n, 4]), [1, 1, 1, 4]) // two
  assert.deepEqual(bridgeGaps([1, n, n, n, 5]), [1, n, n, n, 5]) // stopped for a while: a break, not a flat line
  assert.deepEqual(bridgeGaps([n, n, 3, 4]), [n, n, 3, 4]) // a young series starts later, not at a made-up value
  assert.deepEqual(bridgeGaps([1, 2, n]), [1, 2, 2]) // the current minute not written yet
  assert.deepEqual(bridgeGaps([1, 2, n, n, n]), [1, 2, n, n, n]) // stopped now
  assert.deepEqual(bridgeGaps([]), [])
  assert.deepEqual(segmentsOf([1, 2, n, n, 5, n, 7, 8]), [[0, 1], [4, 4], [6, 7]])
  assert.deepEqual(segmentsOf([n, n]), [])
})
