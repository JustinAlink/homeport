import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMeminfo, parseProcStatCpu, cpuPercentBetween } from '../server/utils/host-system-core.ts'

const MEMINFO = `MemTotal:       32612344 kB
MemFree:        11731948 kB
MemAvailable:   26290436 kB
Buffers:          511172 kB
Cached:         13351400 kB
`

test('parseMeminfo: totals in bytes, used = total - available', () => {
  const m = parseMeminfo(MEMINFO)!
  assert.equal(m.total, 32612344 * 1024)
  assert.equal(m.available, 26290436 * 1024)
  assert.equal(parseMeminfo('garbage'), null)
})

test('parseProcStatCpu: aggregate line, idle includes iowait', () => {
  const s = parseProcStatCpu('cpu  100 5 50 800 20 0 5 0 0 0\ncpu0 50 2 25 400 10 0 2 0 0 0\n')!
  assert.equal(s.idle, 820) // 800 idle + 20 iowait
  assert.equal(s.total, 980)
  assert.equal(parseProcStatCpu('intr 12345'), null)
})

test('cpuPercentBetween: busy fraction of the delta', () => {
  const prev = { idle: 800, total: 1000 }
  const cur = { idle: 850, total: 1100 } // +100 total, +50 idle → 50% busy
  assert.equal(cpuPercentBetween(prev, cur), 50)
  assert.equal(cpuPercentBetween(cur, cur), 0) // no delta
})
