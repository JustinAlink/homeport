import { test } from 'node:test'
import assert from 'node:assert/strict'
import { niceScaleMax } from '../utils/chartScale.ts'

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
