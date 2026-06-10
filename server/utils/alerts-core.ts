// Pure, dependency-free alerting core: transition detection + a debounce/cooldown
// reducer + template rendering. No fs/Docker imports, so it's unit-testable in isolation.

export type AlertKind = 'down' | 'unhealthy' | 'recovered'

export interface ServiceState {
  id: string
  name: string
  host?: string
  state: string // running | exited | restarting | …
  health: string | null // healthy | unhealthy | starting | null
  noalert?: boolean
}

export interface Transition {
  id: string
  name: string
  host?: string
  kind: AlertKind
  from: string
  to: string
}

const isDown = (s: ServiceState) => s.state !== 'running' && s.state !== 'restarting'
const isUnhealthy = (s: ServiceState) => s.health === 'unhealthy'
const isBad = (s: ServiceState) => isDown(s) || isUnhealthy(s)

const label = (s: ServiceState) => {
  if (isDown(s)) return s.state
  if (isUnhealthy(s)) return 'unhealthy'
  return s.health || s.state
}

/**
 * Compare two snapshots and emit a transition per service whose good/bad status
 * flipped. New and vanished services emit nothing (avoids deploy noise). Services
 * marked noalert (in either snapshot) are skipped.
 */
export function detectTransitions(prev: ServiceState[], next: ServiceState[]): Transition[] {
  const prevById = new Map(prev.map((s) => [s.id, s]))
  const out: Transition[] = []
  for (const s of next) {
    if (s.noalert) continue
    const p = prevById.get(s.id)
    if (!p || p.noalert) continue // newly appeared (or was excluded) — no event
    const wasBad = isBad(p)
    const nowBad = isBad(s)
    if (!wasBad && nowBad) {
      out.push({ id: s.id, name: s.name, host: s.host, kind: isDown(s) ? 'down' : 'unhealthy', from: label(p), to: label(s) })
    } else if (wasBad && !nowBad) {
      out.push({ id: s.id, name: s.name, host: s.host, kind: 'recovered', from: label(p), to: label(s) })
    } else if (wasBad && nowBad && label(p) !== label(s)) {
      // bad→bad but the nature changed (e.g. unhealthy → exited): re-classify
      out.push({ id: s.id, name: s.name, host: s.host, kind: isDown(s) ? 'down' : 'unhealthy', from: label(p), to: label(s) })
    }
  }
  return out
}

export interface AlertState {
  consecutiveBad: number
  firing: boolean
  firedAt: number
  lastNotifiedAt: number
}

export const emptyAlertState = (): AlertState => ({ consecutiveBad: 0, firing: false, firedAt: 0, lastNotifiedAt: 0 })

export interface AlertRuleConfig {
  debounceSamples: number // consecutive bad samples before firing
  cooldownSec: number // min seconds between repeat notifications while still bad
  transitions: { down: boolean; unhealthy: boolean; recovered: boolean }
}

/** Current bad classification for a service ('down' | 'unhealthy' | null when good). */
export function badKind(s: ServiceState): 'down' | 'unhealthy' | null {
  if (isDown(s)) return 'down'
  if (isUnhealthy(s)) return 'unhealthy'
  return null
}

/**
 * Advance one service's alert state for the current tick. Driven by the live
 * bad/good status (so debounce counts up even when nothing "transitions" between
 * ticks) — emits at most one event per call. Pure: `now` is passed in.
 */
export function reduceAlertState(
  state: AlertState,
  kind: 'down' | 'unhealthy' | null,
  cfg: AlertRuleConfig,
  now: number,
): { state: AlertState; emit: AlertKind | null } {
  const next = { ...state }

  // Good now → recovery if we were firing
  if (kind === null) {
    const wasFiring = next.firing
    next.consecutiveBad = 0
    next.firing = false
    next.firedAt = 0
    const emit = wasFiring && cfg.transitions.recovered ? 'recovered' : null
    if (emit) next.lastNotifiedAt = now
    return { state: next, emit }
  }

  // Bad now
  next.consecutiveBad = state.consecutiveBad + 1
  const wanted = kind === 'down' ? cfg.transitions.down : cfg.transitions.unhealthy

  // First crossing of the debounce threshold → fire
  if (!next.firing && next.consecutiveBad >= cfg.debounceSamples) {
    next.firing = true
    next.firedAt = now
    if (wanted) {
      next.lastNotifiedAt = now
      return { state: next, emit: kind }
    }
    return { state: next, emit: null }
  }

  // Still bad & already firing → re-notify only after the cooldown elapses
  if (next.firing && wanted && cfg.cooldownSec > 0 && now - next.lastNotifiedAt >= cfg.cooldownSec * 1000) {
    next.lastNotifiedAt = now
    return { state: next, emit: kind }
  }

  return { state: next, emit: null }
}

/** Render a webhook body template. Placeholders: {{name}} {{kind}} {{host}} {{from}} {{to}} {{id}}. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : ''))
}
