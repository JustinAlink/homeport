// Pure, dependency-free parsing for Docker log streams — unit-testable in isolation.
//
// Containers WITHOUT a TTY multiplex stdout/stderr into one stream of frames:
//   [type, 0, 0, 0, len³²ᴮᴱ] + payload   (type: 0=stdin, 1=stdout, 2=stderr)
// Containers WITH a TTY emit a raw byte stream (no headers). We sniff the first
// chunk and fall back to raw passthrough when it doesn't look multiplexed.

export interface LogSegment {
  s: 'stdout' | 'stderr'
  text: string
}

/** Heuristic: does this first chunk start with a plausible multiplex header? */
export function looksMultiplexed(chunk: Uint8Array): boolean {
  if (chunk.length < 8) return false
  const type = chunk[0]
  if (type > 2) return false
  if (chunk[1] !== 0 || chunk[2] !== 0 || chunk[3] !== 0) return false
  const len = ((chunk[4] << 24) | (chunk[5] << 16) | (chunk[6] << 8) | chunk[7]) >>> 0
  return len > 0 && len <= 4 * 1024 * 1024
}

/** Stateful frame demuxer; tolerates frames split across chunks. */
export function createDemuxer() {
  let buf: Uint8Array = new Uint8Array(0)
  let raw: boolean | null = null
  const decoder = new TextDecoder()

  const concat = (a: Uint8Array, b: Uint8Array) => {
    const out = new Uint8Array(a.length + b.length)
    out.set(a, 0)
    out.set(b, a.length)
    return out
  }

  return {
    push(chunk: Uint8Array): LogSegment[] {
      if (raw === true) return chunk.length ? [{ s: 'stdout', text: decoder.decode(chunk, { stream: true }) }] : []

      buf = buf.length ? concat(buf, chunk) : chunk

      // Defer the raw-vs-multiplexed decision until a full header could exist —
      // a first chunk shorter than 8 bytes must not lock us into raw mode.
      if (raw === null) {
        if (buf.length < 8) return []
        raw = !looksMultiplexed(buf)
        if (raw) {
          const text = decoder.decode(buf, { stream: true })
          buf = new Uint8Array(0)
          return text ? [{ s: 'stdout', text }] : []
        }
      }
      const out: LogSegment[] = []
      while (buf.length >= 8) {
        const len = ((buf[4] << 24) | (buf[5] << 16) | (buf[6] << 8) | buf[7]) >>> 0
        if (buf.length < 8 + len) break // incomplete frame — wait for more
        const payload = buf.subarray(8, 8 + len)
        out.push({ s: buf[0] === 2 ? 'stderr' : 'stdout', text: decoder.decode(payload) })
        buf = buf.subarray(8 + len)
      }
      return out
    },
  }
}

export interface LogLine {
  s: 'stdout' | 'stderr'
  line: string
}

/** Reassemble segments into whole lines, keeping per-stream partial-line state. */
export function createLineSplitter() {
  const rest: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }
  return {
    push(seg: LogSegment): LogLine[] {
      const parts = (rest[seg.s] + seg.text).split('\n')
      rest[seg.s] = parts.pop() ?? ''
      return parts.map((line) => ({ s: seg.s, line }))
    },
    flush(): LogLine[] {
      const out: LogLine[] = []
      for (const s of ['stdout', 'stderr'] as const) {
        if (rest[s]) {
          out.push({ s, line: rest[s] })
          rest[s] = ''
        }
      }
      return out
    },
  }
}

/** Split a docker `timestamps:true` line ("2026-06-12T10:00:00.123456789Z msg") into {t, line}. */
export function splitTimestamp(line: string): { t: string; line: string } {
  const sp = line.indexOf(' ')
  if (sp > 0 && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(line.slice(0, sp))) {
    return { t: line.slice(0, sp), line: line.slice(sp + 1) }
  }
  return { t: '', line }
}
