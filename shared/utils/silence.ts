// Alert silences: snoozing one app, pausing every alert for a while, and recurring
// maintenance windows. Pure (no fs, no clock), so the rules are unit-tested.
//
// A silenced service's alert state is reset rather than merely muted. That is what
// keeps the end of a window quiet: whatever went down and came back inside it never
// alerts, and whatever is still down afterwards alerts once, after the usual
// debounce, as if it had just gone down. Muting alone would either flood every
// suppressed alert at the end or leave a still-broken service silent forever.

export interface Snooze {
  until: number
  note?: string
  at: number
}

export interface MaintenanceWindow {
  id: string
  /** 0 = Sunday ... 6 = Saturday, like Date.getDay() */
  days: number[]
  /** local server time, "HH:MM" */
  start: string
  end: string
  note?: string
}

export interface Silences {
  /** keyed by `<hostId>|<container name>` (stable across recreates) */
  snoozes: Record<string, Snooze>
  /** every alert paused until then (0 = not paused) */
  pausedUntil: number
  pauseNote?: string
}

export const emptySilences = (): Silences => ({ snoozes: {}, pausedUntil: 0 })

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
export const validTime = (t: string) => HHMM.test(t)
const minutes = (t: string) => {
  const m = HHMM.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1
}

/** A window the editor can save: at least one day, two valid times that differ. */
export function validWindow(w: Partial<MaintenanceWindow>): w is MaintenanceWindow {
  return (
    !!w &&
    typeof w.id === 'string' &&
    Array.isArray(w.days) &&
    w.days.length > 0 &&
    w.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    typeof w.start === 'string' &&
    typeof w.end === 'string' &&
    validTime(w.start) &&
    validTime(w.end) &&
    w.start !== w.end
  )
}

/**
 * Is `local` (day of week + minute of day, in the server's time zone) inside the
 * window? A window whose end is before its start runs past midnight: Saturday
 * 23:00 to 01:00 covers Saturday night and the first hour of Sunday.
 */
export function inWindow(w: MaintenanceWindow, local: { day: number; minute: number }): boolean {
  const start = minutes(w.start)
  const end = minutes(w.end)
  if (start < 0 || end < 0) return false
  if (start < end) return w.days.includes(local.day) && local.minute >= start && local.minute < end
  // overnight: the part after midnight belongs to the day the window started
  const yesterday = (local.day + 6) % 7
  return (w.days.includes(local.day) && local.minute >= start) || (w.days.includes(yesterday) && local.minute < end)
}

export type SilenceReason = { kind: 'snooze'; until: number; note?: string } | { kind: 'pause'; until: number; note?: string } | { kind: 'window'; window: MaintenanceWindow }

/**
 * Why alerts for `key` are silent right now, or null. `key` is a service key; a
 * domain passes its owning service's key, so snoozing an app also covers its
 * domains. Without a key (host alerts) only the global pause and windows apply.
 */
export function silencedBy(
  key: string | null,
  now: number,
  local: { day: number; minute: number },
  s: Silences,
  windows: MaintenanceWindow[],
): SilenceReason | null {
  if (s.pausedUntil > now) return { kind: 'pause', until: s.pausedUntil, ...(s.pauseNote ? { note: s.pauseNote } : {}) }
  const w = windows.find((x) => inWindow(x, local))
  if (w) return { kind: 'window', window: w }
  const sn = key ? s.snoozes[key] : undefined
  if (sn && sn.until > now) return { kind: 'snooze', until: sn.until, ...(sn.note ? { note: sn.note } : {}) }
  return null
}

/** Drop snoozes and a pause that have ended, so the file doesn't grow and the UI stays honest. */
export function pruneSilences(s: Silences, now: number): Silences {
  const snoozes = Object.fromEntries(Object.entries(s.snoozes).filter(([, v]) => v.until > now))
  const paused = s.pausedUntil > now
  return { snoozes, pausedUntil: paused ? s.pausedUntil : 0, ...(paused && s.pauseNote ? { pauseNote: s.pauseNote } : {}) }
}

/** The stable key of a service id + container name: `<hostId>|<name>`. */
export function serviceKey(id: string, name: string): string {
  const sep = id.indexOf('::')
  return `${sep >= 0 ? id.slice(0, sep) : 'default'}|${name}`
}
