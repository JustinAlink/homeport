import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSeries, appendPoint, readRange, serialize, deserialize } from '../server/utils/history-core.ts'

const MIN = 60_000
const base = 1_700_000_040_000 // fixed epoch, aligned to a 60s slot boundary

test('appendPoint: same slot → last sample wins', () => {
  const s = createSeries(60, 100)
  appendPoint(s, base, 10, 100)
  appendPoint(s, base + 5_000, 20, 200) // same 60s slot
  assert.equal(s.t.length, 1)
  assert.equal(s.cpu[0], 20)
  assert.equal(s.mem[0], 200)
})

test('appendPoint: new slot advances', () => {
  const s = createSeries(60, 100)
  appendPoint(s, base, 10, 100)
  appendPoint(s, base + MIN, 30, 300)
  assert.equal(s.t.length, 2)
  assert.deepEqual(s.cpu, [10, 30])
  assert.equal(s.t[1] - s.t[0], MIN)
})

test('appendPoint: out-of-order/old sample ignored', () => {
  const s = createSeries(60, 100)
  appendPoint(s, base + MIN, 30, 300)
  appendPoint(s, base, 10, 100) // older slot
  assert.equal(s.t.length, 1)
  assert.equal(s.cpu[0], 30)
})

test('appendPoint: trims to cap (drops oldest)', () => {
  const s = createSeries(60, 3)
  for (let i = 0; i < 5; i++) appendPoint(s, base + i * MIN, i, i * 10)
  assert.equal(s.t.length, 3)
  assert.deepEqual(s.cpu, [2, 3, 4]) // oldest two dropped
})

test('readRange: gap-fills missing slots with null, evenly spaced', () => {
  const s = createSeries(60, 100)
  appendPoint(s, base, 10, 100)
  // skip one slot
  appendPoint(s, base + 2 * MIN, 30, 300)
  const r = readRange(s, base, base + 2 * MIN)
  assert.deepEqual(r.t, [base, base + MIN, base + 2 * MIN])
  assert.deepEqual(r.cpu, [10, null, 30])
  assert.deepEqual(r.mem, [100, null, 300])
})

test('readRange: windows to [from,to]', () => {
  const s = createSeries(60, 100)
  for (let i = 0; i < 5; i++) appendPoint(s, base + i * MIN, i, i)
  const r = readRange(s, base + MIN, base + 3 * MIN)
  assert.deepEqual(r.cpu, [1, 2, 3])
})

test('serialize/deserialize round-trip', () => {
  const s = createSeries(60, 100)
  appendPoint(s, base, 10, 100)
  appendPoint(s, base + MIN, 20, 200)
  const back = deserialize(serialize(s))
  assert.ok(back)
  assert.deepEqual(back, s)
})

test('deserialize: garbage → null', () => {
  assert.equal(deserialize('not json'), null)
  assert.equal(deserialize('{"nope":1}'), null)
})

// ---- rollups, tiers, uptime (7 d / 30 d history) ----
import {
  createRollup,
  createStore,
  addToRollup,
  recordSample,
  readRollup,
  readStore,
  pickTier,
  uptimeIn,
  uptimeFor,
  uptimeDays,
  dayEdges,
  countsAsUp,
  serializeStore,
  deserializeStore,
  encodeKey,
  parseRangeHours,
  ROLLUP_TIERS,
  MAX_POINTS,
} from '../server/utils/history-core.ts'

const H = 3_600_000
const DAY = 24 * H
const Q = 15 * MIN
const hourStart = 1_700_002_800_000 // aligned to a whole hour (and so to 15 min and 1 min)

test('rollup: a bucket holds the mean of every sample in it, not the last one', () => {
  const r = createRollup(900, 10)
  addToRollup(r, hourStart, { cpu: 10, mem: 100 })
  addToRollup(r, hourStart + 30_000, { cpu: 20, mem: 300 })
  addToRollup(r, hourStart + 14 * MIN, { cpu: 60, mem: 200 })
  assert.equal(r.t.length, 1)
  assert.equal(r.w[0], 3)
  assert.equal(r.cpu[0], 30)
  assert.equal(r.mem[0], 200)
  addToRollup(r, hourStart + Q, { cpu: 5, mem: 50 }) // next bucket
  assert.deepEqual(r.t, [hourStart, hourStart + Q])
  assert.equal(r.cpu[1], 5)
})

test('rollup: a status-only sample counts toward uptime without dragging the mean to 0', () => {
  const r = createRollup(900, 10)
  addToRollup(r, hourStart, { cpu: 40, mem: 400, up: true })
  addToRollup(r, hourStart + MIN, { up: false }) // stopped: no stats
  assert.equal(r.cpu[0], 40)
  assert.equal(r.w[0], 1)
  assert.equal(r.n[0], 2)
  assert.equal(r.up[0], 1)
})

test('rollup: an older bucket is ignored', () => {
  const r = createRollup(900, 10)
  addToRollup(r, hourStart + Q, { cpu: 1, mem: 1, up: true })
  addToRollup(r, hourStart, { cpu: 99, mem: 99, up: false })
  assert.deepEqual(r.t, [hourStart + Q])
  assert.equal(r.cpu[0], 1)
  assert.equal(r.n[0], 1)
})

test('retention: a tier keeps at most cap buckets', () => {
  const r = createRollup(3600, 3)
  for (let i = 0; i < 5; i++) addToRollup(r, hourStart + i * H, { cpu: i, mem: i, up: true })
  assert.deepEqual(r.cpu, [2, 3, 4])
  assert.equal(r.w.length, 3)
  assert.equal(r.n.length, 3)
})

test('retention: after a long gap, buckets older than the window go even under the cap', () => {
  // homeport was off for 40 days: the 30-day tier must not keep a 40-day-old bucket
  const r = createRollup(3600, 720)
  addToRollup(r, hourStart, { cpu: 1, mem: 1, up: false })
  addToRollup(r, hourStart + 40 * DAY, { cpu: 2, mem: 2, up: true })
  assert.deepEqual(r.t, [hourStart + 40 * DAY])
  assert.equal(uptimeIn(r, hourStart + 10 * DAY, hourStart + 41 * DAY).ratio, 1)
  // the fine ring too
  const s = createSeries(60, 1440)
  appendPoint(s, base, 1, 1)
  appendPoint(s, base + 2 * DAY, 2, 2)
  assert.deepEqual(s.cpu, [2])
})

test('readRollup: evenly spaced, null where nothing ran (w = 0) or nothing was kept', () => {
  const r = createRollup(900, 100)
  addToRollup(r, hourStart, { cpu: 10, mem: 100, up: true })
  addToRollup(r, hourStart + Q, { up: false }) // stopped all bucket
  addToRollup(r, hourStart + 3 * Q, { cpu: 30, mem: 300, up: true })
  const out = readRollup(r, hourStart, hourStart + 3 * Q)
  assert.equal(out.res, 900)
  assert.deepEqual(out.t, [hourStart, hourStart + Q, hourStart + 2 * Q, hourStart + 3 * Q])
  assert.deepEqual(out.cpu, [10, null, null, 30])
})

test('pickTier: the finest tier that reaches back far enough within the point budget', () => {
  const tiers = [{ res: 60, cap: 1440 }, ...ROLLUP_TIERS]
  assert.equal(pickTier(tiers, 1 * H), 0)
  assert.equal(pickTier(tiers, 24 * H), 0) // 1440 one-minute points
  assert.equal(pickTier(tiers, 25 * H), 1) // past the fine ring: 15 min
  assert.equal(pickTier(tiers, 7 * DAY), 1) // 672 points
  assert.equal(pickTier(tiers, 8 * DAY), 2) // past a week: hourly
  assert.equal(pickTier(tiers, 30 * DAY), 2) // 720 points
  assert.equal(pickTier(tiers, 90 * DAY), 2) // beyond every tier: the coarsest
  // a fine ring kept for 7 days (HOMEPORT_HISTORY_RETENTION_HOURS=168) still hands
  // 7 d to the 15 min tier: 10080 one-minute points is too many for one graph
  assert.equal(pickTier([{ res: 60, cap: 10080 }, ...ROLLUP_TIERS], 7 * DAY), 1)
  assert.ok(7 * DAY / (ROLLUP_TIERS[0].res * 1000) <= MAX_POINTS)
})

test('readStore: 24 h comes from the minute ring, 7 d and 30 d from their rollups', () => {
  const s = createStore(60, 1440)
  // a 30 s collector, alternating 10% and 30%: 30 samples per 15 min bucket
  for (let i = 0; i < 6 * 120; i++) recordSample(s, hourStart + i * 30_000, { cpu: i % 2 ? 30 : 10, mem: 100, up: true })
  const now = hourStart + 6 * H - 30_000
  assert.equal(readStore(s, now - 24 * H, now).res, 60)
  const week = readStore(s, now - 7 * DAY, now)
  assert.equal(week.res, 900)
  assert.equal(week.cpu.filter((v) => v != null).length, 24) // six hours of 15 min buckets
  assert.equal(week.cpu.at(-1), 20) // alternating 10/30 averages to 20
  const month = readStore(s, now - 30 * DAY, now)
  assert.equal(month.res, 3600)
  assert.equal(month.cpu.filter((v) => v != null).length, 6)
})

test('uptime: up samples over observed samples, across the buckets in the window', () => {
  const r = createRollup(900, 672)
  // 4 buckets, 30 samples each (30 s collector): one bucket with 3 down samples
  for (let b = 0; b < 4; b++) for (let k = 0; k < 30; k++) addToRollup(r, hourStart + b * Q + k * 30_000, { up: !(b === 2 && k < 3) })
  const u = uptimeIn(r, hourStart, hourStart + H, 30_000)
  assert.equal(u.n, 120)
  assert.equal(u.up, 117)
  assert.equal(u.ratio, 117 / 120)
  assert.equal(u.since, hourStart)
  assert.equal(u.downMs, 90_000) // 3 samples of 30 s
  // a window that only covers the healthy buckets
  assert.equal(uptimeIn(r, hourStart, hourStart + 2 * Q - 1).ratio, 1)
})

test('uptime: downtime of a bucket homeport saw only part of is not stretched over the bucket', () => {
  // a container first seen at minute 14 of a 15 min bucket: one up, one down sample
  const r = createRollup(900, 672)
  addToRollup(r, hourStart + 14 * MIN, { up: true })
  addToRollup(r, hourStart + 14 * MIN + 30_000, { up: false })
  assert.equal(uptimeIn(r, hourStart, hourStart + Q, 30_000).downMs, 30_000)
  // the share-of-span fallback would have said 7.5 minutes
  assert.equal(uptimeIn(r, hourStart, hourStart + Q).downMs, 450_000)
})

test('uptime: time nobody watched is neither up nor down', () => {
  const r = createRollup(3600, 720)
  addToRollup(r, hourStart, { up: true })
  addToRollup(r, hourStart + 10 * DAY, { up: true }) // ten days of homeport being off between
  const u = uptimeIn(r, hourStart - 20 * DAY, hourStart + 10 * DAY + H)
  assert.equal(u.ratio, 1)
  assert.equal(u.since, hourStart) // the data starts here, not 30 days ago
  assert.equal(uptimeIn(createRollup(3600, 720), 0, hourStart).ratio, null)
})

test('uptime: windows of 24 h and 7 d come from the 15 min tier, 30 d from the hourly one', () => {
  const s = createStore(60, 1440)
  // down for the first hour of an otherwise up 9 days
  const start = hourStart
  for (let t = start; t < start + 9 * DAY; t += 5 * MIN) recordSample(s, t, { up: t >= start + H })
  const now = start + 9 * DAY - 1
  assert.equal(uptimeFor(s, 24 * H, now).ratio, 1)
  const month = uptimeFor(s, 30 * DAY, now, 5 * MIN)
  assert.equal(month.n, 9 * 24 * 12)
  assert.equal(month.ratio, 1 - 12 / (9 * 24 * 12))
  assert.equal(month.downMs, H)
})

test('countsAsUp: running and not unhealthy; starting counts as up', () => {
  assert.equal(countsAsUp('running', null), true)
  assert.equal(countsAsUp('running', 'healthy'), true)
  assert.equal(countsAsUp('running', 'starting'), true)
  assert.equal(countsAsUp('running', 'unhealthy'), false)
  for (const st of ['exited', 'restarting', 'paused', 'created', 'dead']) assert.equal(countsAsUp(st, null), false, st)
})

test('dayEdges: calendar days in the viewer zone, ending at now', () => {
  const now = Date.UTC(2026, 10, 25, 10, 30) // 11:30 in CET
  const e = dayEdges(now, 3, -60)
  assert.equal(e.length, 4)
  assert.equal(e[2], Date.UTC(2026, 10, 24, 23, 0)) // midnight CET today
  assert.equal(e[0], Date.UTC(2026, 10, 22, 23, 0))
  assert.equal(e[3], now)
  // past 23:00 UTC it is already tomorrow in CET
  assert.equal(dayEdges(Date.UTC(2026, 10, 25, 23, 30), 1, -60)[0], Date.UTC(2026, 10, 25, 23, 0))
})

test('uptimeDays: one figure per day; a day without data is null, not 100%', () => {
  const s = createStore(60, 1440)
  const day0 = Date.UTC(2026, 10, 20)
  for (let t = day0; t < day0 + DAY; t += 30 * MIN) recordSample(s, t, { up: true })
  for (let t = day0 + 2 * DAY; t < day0 + 3 * DAY; t += 30 * MIN) recordSample(s, t, { up: t >= day0 + 2 * DAY + 12 * H }) // down all morning
  const days = uptimeDays(s, dayEdges(day0 + 3 * DAY - 1, 3, 0), 30 * MIN)
  assert.deepEqual(days.map((d) => d.ratio), [1, null, 0.5])
  assert.equal(days[2].downMs, 12 * H)
})

test('migration: a v1 file (bare 24 h ring) becomes the fine tier and seeds the rollups', () => {
  const v1 = createSeries(60, 1440)
  for (let i = 0; i < 120; i++) appendPoint(v1, hourStart + i * MIN, i < 60 ? 10 : 20, 256)
  const store = deserializeStore(serialize(v1))
  assert.ok(store)
  assert.deepEqual(store.fine, v1) // nothing lost
  assert.equal(store.tiers.length, ROLLUP_TIERS.length)
  const hourly = store.tiers[1]
  assert.deepEqual(hourly.cpu, [10, 20])
  assert.deepEqual(hourly.w, [60, 60])
  // a v1 file only has points while the container ran: it carries no uptime
  assert.deepEqual(hourly.n, [0, 0])
  assert.equal(uptimeIn(hourly, hourStart, hourStart + 2 * H).ratio, null)
})

test('store files round-trip; a damaged tier starts empty instead of losing the file', () => {
  const s = createStore(60, 1440)
  for (let i = 0; i < 40; i++) recordSample(s, hourStart + i * MIN, { cpu: 12.345, mem: 99.99, up: i % 4 !== 0 })
  recordSample(s, hourStart + 3 * H + 7 * MIN, { cpu: 1, mem: 2, up: true }) // after a gap: times are stored as steps
  const back = deserializeStore(serializeStore(s))
  assert.ok(back)
  assert.deepEqual(back.fine, s.fine)
  assert.deepEqual(back.tiers.map((r) => r.t), s.tiers.map((r) => r.t))
  assert.deepEqual(deserializeStore(serializeStore(createStore(60, 1440))), createStore(60, 1440))
  assert.deepEqual(back.tiers[0].n, s.tiers[0].n)
  assert.equal(back.tiers[0].cpu[0], 12.35) // means are rounded on disk
  const raw = JSON.parse(serializeStore(s))
  raw.tiers[1].up = [1, 2, 3] // wrong length
  const partial = deserializeStore(JSON.stringify(raw))
  assert.ok(partial)
  assert.deepEqual(partial.tiers[0].t, s.tiers[0].t)
  assert.equal(partial.tiers[1].t.length, 0)
  assert.equal(deserializeStore('{"v":2}'), null)
  assert.equal(deserializeStore('nope'), null)
})

test('encodeKey: injective file names (my-app and my_app stay apart)', () => {
  assert.equal(encodeKey('default|my-app'), 'default~7cmy-app')
  assert.notEqual(encodeKey('default|my-app'), encodeKey('default|my_app'))
  assert.notEqual(encodeKey('a|b~7c'), encodeKey('a~7cb|'))
  assert.match(encodeKey('pi|ünï'), /^[A-Za-z0-9_.~-]+$/)
})

test('parseRangeHours: hours or days, clamped to 1 h .. 30 d', () => {
  assert.equal(parseRangeHours('6h'), 6)
  assert.equal(parseRangeHours('7d'), 168)
  assert.equal(parseRangeHours('30d'), 720)
  assert.equal(parseRangeHours('90d'), 720)
  assert.equal(parseRangeHours('0h'), 1)
  assert.equal(parseRangeHours('1w'), 6)
  assert.equal(parseRangeHours(undefined, 24), 24)
})
