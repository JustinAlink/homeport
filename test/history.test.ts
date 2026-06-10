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
