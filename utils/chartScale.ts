// The dashboard's usage chart plots percentages. On a big host everything sits
// near zero (0.6% CPU on 12 cores), so a fixed 0 to 100% scale draws flat lines
// at the bottom. Fit the scale to the data instead, on a round step with headroom,
// never above the cap; the axis labels show the real values.
const STEPS = [5, 10, 20, 25, 50, 75, 100]

export function niceScaleMax(peak: number, cap = 100): number {
  const want = Math.max(0, peak) * 1.25
  return Math.min(cap, STEPS.find((s) => s >= want) ?? cap)
}

const MIN = 60_000
const TICK_STEPS = [10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 7200, 10080].map((m) => m * MIN)

/**
 * Time-axis ticks for a history graph: on round local times (every 4 h, every day,
 * every 5 days...), at most maxTicks of them. tzOffsetMin is Date#getTimezoneOffset().
 * `daily` says the labels should be dates rather than times of day.
 */
export function timeTicks(fromMs: number, toMs: number, tzOffsetMin: number, maxTicks = 6): { at: number[]; daily: boolean } {
  const span = toMs - fromMs
  if (!(span > 0) || maxTicks < 1) return { at: [], daily: false }
  const step = TICK_STEPS.find((s) => span / s <= maxTicks) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const off = tzOffsetMin * MIN
  const at: number[] = []
  for (let t = Math.ceil((fromMs - off) / step) * step + off; t <= toMs; t += step) at.push(t)
  return { at, daily: step >= 1440 * MIN }
}

/**
 * History with its gaps made honest. A missed sample or two (a slow collector
 * tick, the current minute not written yet) is bridged with the previous value,
 * so the line doesn't flicker; a longer stretch with nothing recorded (the
 * container was stopped, homeport was off) stays null, and the graph draws a
 * break there instead of a flat line that looks like real, steady usage. Leading
 * nulls stay null too: the series simply starts later.
 */
export function bridgeGaps(a: (number | null)[], maxGap = 2): (number | null)[] {
  const out = a.slice()
  let i = 0
  while (i < out.length) {
    if (out[i] != null) {
      i++
      continue
    }
    let j = i
    while (j < out.length && out[j] == null) j++
    // a short run after a real value is bridged; a run at the start never is
    if (i > 0 && j - i <= maxGap) for (let k = i; k < j; k++) out[k] = out[i - 1]
    i = j
  }
  return out
}

/** Consecutive runs of real values, as [start, end] index pairs (end inclusive). */
export function segmentsOf(a: (number | null)[]): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  a.forEach((v, i) => {
    if (v != null && start < 0) start = i
    if (v == null && start >= 0) {
      out.push([start, i - 1])
      start = -1
    }
  })
  if (start >= 0) out.push([start, a.length - 1])
  return out
}
