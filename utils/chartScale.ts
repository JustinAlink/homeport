// The dashboard's usage chart plots percentages. On a big host everything sits
// near zero (0.6% CPU on 12 cores), so a fixed 0 to 100% scale draws flat lines
// at the bottom. Fit the scale to the data instead, on a round step with headroom,
// never above the cap; the axis labels show the real values.
const STEPS = [5, 10, 20, 25, 50, 75, 100]

export function niceScaleMax(peak: number, cap = 100): number {
  const want = Math.max(0, peak) * 1.25
  return Math.min(cap, STEPS.find((s) => s >= want) ?? cap)
}
