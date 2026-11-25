// Formatting for uptime figures (service page card; a status page can reuse it).
// Pure, so test/uptime-format.test.ts can pin the rules down.

/**
 * "100%" only when nothing was down; otherwise rounded DOWN to two decimals, so
 * a container that was down for a minute in a month reads 99.99% and not 100%.
 */
export function formatUptime(ratio: number | null | undefined): string {
  if (ratio == null) return 'No data'
  if (ratio >= 1) return '100%'
  // two decimals from 10% up, one below; the epsilon keeps 0.9983 from flooring to 99.82
  const dec = ratio >= 0.1 ? 2 : 1
  const pct = Math.floor(ratio * 100 * 10 ** dec + 1e-6) / 10 ** dec
  return `${pct}%`
}

/** "40 min", "3 h 5 min", "2 d 4 h": rough on purpose (it is an estimate from samples). */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'under a minute'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`
}

export type UptimeTone = 'ok' | 'warn' | 'bad' | 'none'

/** Day bar colour: fully up, some downtime, or down for a real part of the day (over ~1 h 10 min). */
export function uptimeTone(ratio: number | null | undefined): UptimeTone {
  if (ratio == null) return 'none'
  if (ratio >= 0.9995) return 'ok'
  if (ratio >= 0.95) return 'warn'
  return 'bad'
}
