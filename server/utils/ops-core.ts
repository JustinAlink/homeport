// Pure line-buffer logic for streamed operations (see ops.ts), unit-testable in
// isolation. The buffer is bounded, so lines are dropped from the front; readers
// therefore track ABSOLUTE line numbers. A reader index into the array alone
// pointed past the end once trimming began, and a live view went silent after
// line 2000 of a long pull while the op kept running.

export const OP_LINE_CAP = 2000

export interface LineBuffer {
  lines: string[]
  /** lines dropped from the front so far: the absolute number of lines[0] */
  trimmed: number
}

export function pushLine(buf: LineBuffer, line: string, cap = OP_LINE_CAP): void {
  buf.lines.push(line)
  const over = buf.lines.length - cap
  if (over > 0) {
    buf.lines.splice(0, over)
    buf.trimmed += over
  }
}

/**
 * What a reader at absolute position `cursor` has not seen yet. `skipped` is
 * how many of those were already dropped (a reader that attached late), and
 * `next` is the reader's new cursor.
 */
export function readLines(buf: LineBuffer, cursor: number): { lines: string[]; skipped: number; next: number } {
  const start = Math.max(cursor, buf.trimmed)
  return { lines: buf.lines.slice(start - buf.trimmed), skipped: start - cursor, next: buf.trimmed + buf.lines.length }
}
