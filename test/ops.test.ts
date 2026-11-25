import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushLine, readLines, OP_LINE_CAP, type LineBuffer } from '../server/utils/ops-core.ts'

// A live view of a long pull went silent after line 2000: the buffer was trimmed
// from the front while the reader's index into it kept pointing past the end.
test('a reader that follows along receives every line, past the buffer cap', () => {
  const buf: LineBuffer = { lines: [], trimmed: 0 }
  const got: string[] = []
  let cursor = 0
  for (let i = 0; i < OP_LINE_CAP + 500; i++) {
    pushLine(buf, `line ${i}`)
    const r = readLines(buf, cursor)
    assert.equal(r.skipped, 0)
    got.push(...r.lines)
    cursor = r.next
  }
  assert.equal(got.length, OP_LINE_CAP + 500)
  assert.equal(got.at(-1), `line ${OP_LINE_CAP + 499}`)
  assert.equal(buf.lines.length, OP_LINE_CAP) // memory stays bounded
})

test('a reader that attaches late gets the kept tail and how many lines it missed', () => {
  const buf: LineBuffer = { lines: [], trimmed: 0 }
  for (let i = 0; i < 2500; i++) pushLine(buf, `line ${i}`)
  const r = readLines(buf, 0)
  assert.equal(r.skipped, 500)
  assert.equal(r.lines.length, OP_LINE_CAP)
  assert.equal(r.lines[0], 'line 500')
  assert.equal(r.next, 2500)
  assert.deepEqual(readLines(buf, r.next), { lines: [], skipped: 0, next: 2500 }) // caught up
})
