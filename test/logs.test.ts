import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDemuxer, createLineSplitter, looksMultiplexed, splitTimestamp } from '../server/utils/logs-core.ts'

const enc = new TextEncoder()

function frame(type: 0 | 1 | 2, text: string): Uint8Array {
  const payload = enc.encode(text)
  const out = new Uint8Array(8 + payload.length)
  out[0] = type
  out[4] = (payload.length >>> 24) & 0xff
  out[5] = (payload.length >>> 16) & 0xff
  out[6] = (payload.length >>> 8) & 0xff
  out[7] = payload.length & 0xff
  out.set(payload, 8)
  return out
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

test('demux: interleaved stdout/stderr frames', () => {
  const d = createDemuxer()
  const segs = d.push(concat(frame(1, 'out line\n'), frame(2, 'err line\n'), frame(1, 'more\n')))
  assert.deepEqual(segs, [
    { s: 'stdout', text: 'out line\n' },
    { s: 'stderr', text: 'err line\n' },
    { s: 'stdout', text: 'more\n' },
  ])
})

test('demux: frame split mid-header and mid-payload across pushes', () => {
  const whole = concat(frame(1, 'hello world\n'), frame(2, 'oops\n'))
  const d = createDemuxer()
  const collected = [
    ...d.push(whole.subarray(0, 3)), // partial header
    ...d.push(whole.subarray(3, 14)), // rest of header + partial payload
    ...d.push(whole.subarray(14)), // remainder
  ]
  assert.deepEqual(collected, [
    { s: 'stdout', text: 'hello world\n' },
    { s: 'stderr', text: 'oops\n' },
  ])
})

test('demux: TTY raw stream passes through as stdout', () => {
  const d = createDemuxer()
  const segs = d.push(enc.encode('plain tty output\n'))
  assert.deepEqual(segs, [{ s: 'stdout', text: 'plain tty output\n' }])
  // stays raw on subsequent pushes even if bytes look header-ish
  const more = d.push(enc.encode('x'))
  assert.equal(more[0].s, 'stdout')
})

test('looksMultiplexed: header heuristic', () => {
  assert.equal(looksMultiplexed(frame(1, 'hi')), true)
  assert.equal(looksMultiplexed(enc.encode('2026-06-12 log line')), false)
  assert.equal(looksMultiplexed(new Uint8Array([1, 0, 0])), false) // too short
})

test('line splitter: reassembles partial lines per stream', () => {
  const ls = createLineSplitter()
  assert.deepEqual(ls.push({ s: 'stdout', text: 'par' }), [])
  assert.deepEqual(ls.push({ s: 'stderr', text: 'whole err\n' }), [{ s: 'stderr', line: 'whole err' }])
  assert.deepEqual(ls.push({ s: 'stdout', text: 'tial\nnext' }), [{ s: 'stdout', line: 'partial' }])
  assert.deepEqual(ls.flush(), [{ s: 'stdout', line: 'next' }])
})

test('splitTimestamp: docker timestamps split off, plain lines untouched', () => {
  const ts = splitTimestamp('2026-06-12T10:00:00.123456789Z GET / 200')
  assert.equal(ts.t, '2026-06-12T10:00:00.123456789Z')
  assert.equal(ts.line, 'GET / 200')
  const plain = splitTimestamp('no timestamp here')
  assert.equal(plain.t, '')
  assert.equal(plain.line, 'no timestamp here')
})
