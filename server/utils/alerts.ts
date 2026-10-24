import { readFileSync, writeFileSync, mkdirSync, existsSync, accessSync, constants } from 'node:fs'
import { log as logger, warnOnce } from './log'
import { join, dirname } from 'node:path'
import type { Snapshot } from './collector'
import { getConfig } from './config'
import {
  type ServiceState,
  type AlertState,
  type Transition,
  emptyAlertState,
  detectTransitions,
  reduceAlertState,
  badKind,
  domainTargets,
  domainDown,
  domainLabel,
} from './alerts-core'
import { pingAll } from './ping'
import { findProxyName } from './ping-core'
import { getHosts } from './hosts'
import { getNotifiers, type AlertEvent } from './notifiers'

// Effectful alerting layer: turns successive collector snapshots into debounced
// alert events, fans them out to webhook channels, and keeps a small in-app log.
// State + log persist under ${HOMEPORT_DATA_DIR}/alerts/ so homeport restarting
// doesn't re-page every already-down service. The decision logic is pure (alerts-core).

const LOG_CAP = 200

const dir = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'alerts')
const stateFile = () => join(dir(), 'state.json')
const logFile = () => join(dir(), 'log.json')

let stateCache: Record<string, AlertState> | null = null
let logCache: AlertEvent[] | null = null
let prevStates = new Map<string, ServiceState>()
const originLabel = new Map<string, string>() // label captured when a service first went bad
let writable: boolean | null = null

function canWrite(): boolean {
  if (writable !== null) return writable
  try {
    let p = dir()
    while (!existsSync(p)) {
      const parent = dirname(p)
      if (parent === p) return (writable = false)
      p = parent
    }
    accessSync(p, constants.W_OK)
    writable = true
  } catch {
    writable = false
  }
  if (!writable) {
    warnOnce('alerts-ro', 'alerts', 'data dir is not writable — alert state/history is in-memory only (may re-notify after a restart)')
  }
  return writable
}

function loadState(): Record<string, AlertState> {
  if (stateCache) return stateCache
  try {
    stateCache = JSON.parse(readFileSync(stateFile(), 'utf8'))
  } catch {
    stateCache = {}
  }
  return stateCache!
}

function loadLog(): AlertEvent[] {
  if (logCache) return logCache
  try {
    const arr = JSON.parse(readFileSync(logFile(), 'utf8'))
    logCache = Array.isArray(arr) ? arr : []
  } catch {
    logCache = []
  }
  return logCache!
}

function persist() {
  if (!canWrite()) return
  try {
    mkdirSync(dir(), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify(stateCache ?? {}))
    writeFileSync(logFile(), JSON.stringify(logCache ?? []))
  } catch {
    // best-effort
  }
}

/** Whether alert state/log are persisted (false on a read-only data dir). */
export const alertsPersistent = () => canWrite()

/** Recent alert events, newest first. */
export function recentAlerts(limit = 100): AlertEvent[] {
  return loadLog().slice(-limit).reverse()
}

/** Dispatch an event to all configured channels; optionally record it in the log. */
export async function dispatch(event: AlertEvent, record = true): Promise<{ name: string; ok: boolean; error?: string }[]> {
  if (record) {
    const log = loadLog()
    log.push(event)
    if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP)
  }
  const cfg = getConfig()
  const notifiers = getNotifiers(
    cfg.alertChannels,
    cfg.smtpHost ? { host: cfg.smtpHost, port: cfg.smtpPort, secure: cfg.smtpSecure, user: cfg.smtpUser || undefined, pass: cfg.smtpPass || undefined, from: cfg.smtpFrom, to: cfg.smtpTo } : null,
  )
  const results = await Promise.all(
    notifiers.map(async (n) => {
      try {
        const r = await n.send(event)
        return { name: n.name, ok: r.ok, error: r.error }
      } catch (e: any) {
        return { name: n.name, ok: false, error: e?.message || String(e) }
      }
    }),
  )
  if (record) persist()
  return results
}

/** Called by the collector each tick: detect → debounce → notify. */
export async function evaluateAlerts(snap: Snapshot): Promise<void> {
  const cfg = getConfig()
  if (!cfg.alertsEnabled) {
    // still track states so enabling later doesn't immediately fire on stale history
    prevStates = new Map(snap.services.map((s) => [s.id, toState(s)]))
    return
  }

  const next: ServiceState[] = snap.services.map(toState)
  const prevArr = [...prevStates.values()]
  const transitions = new Map<string, Transition>()
  for (const t of detectTransitions(prevArr, next)) transitions.set(t.id, t)

  const state = loadState()
  const now = snap.at
  const rule = {
    debounceSamples: cfg.alertDebounceSamples,
    cooldownSec: cfg.alertCooldownSec,
    transitions: cfg.alertTransitions,
  }
  const events: AlertEvent[] = []

  for (const s of next) {
    if (s.noalert) continue
    const kind = badKind(s)

    // Capture the "from" label at the moment a service first goes bad.
    const tr = transitions.get(s.id)
    if (tr && (tr.kind === 'down' || tr.kind === 'unhealthy')) originLabel.set(s.id, tr.from)

    const cur = state[s.id] ?? emptyAlertState()
    const { state: nextState, emit } = reduceAlertState(cur, kind, rule, now)
    state[s.id] = nextState

    if (emit) {
      const from = emit === 'recovered' ? originLabel.get(s.id) || 'down' : originLabel.get(s.id) || ''
      const to = emit === 'recovered' ? labelOf(s) : labelOf(s)
      events.push({ id: s.id, name: s.name, host: s.host, kind: emit, from, to, at: now })
      if (emit === 'recovered') originLabel.delete(s.id)
    }
  }

  // prune state for vanished services (domain states are evaluateDomainAlerts' own)
  const ids = new Set(next.map((s) => s.id))
  for (const id of Object.keys(state)) if (!id.startsWith('domain:') && !ids.has(id)) delete state[id]

  prevStates = new Map(next.map((s) => [s.id, s]))
  stateCache = state

  if (events.length) {
    for (const e of events) {
      // The automated path used to discard delivery results — a channel that's
      // been failing for days produced no signal. Log every failed send.
      const results = await dispatch(e)
      for (const r of results.filter((x) => !x.ok)) {
        logger.warn('alerts', `notifier "${r.name}" failed to deliver "${e.kind}" alert for ${e.name}`, r.error)
      }
    }
  } else {
    persist() // checkpoint debounce counters
  }
}

function toState(s: { id: string; displayName: string; host?: string; state: string; health: string | null; noalert: boolean }): ServiceState {
  return { id: s.id, name: s.displayName, host: s.host, state: s.state, health: s.health, noalert: s.noalert }
}

function labelOf(s: ServiceState): string {
  if (s.state !== 'running' && s.state !== 'restarting') return s.state
  if (s.health === 'unhealthy') return 'unhealthy'
  return s.health || s.state
}

/**
 * Domains that stop answering (5xx or nothing) while their container runs: the
 * app is up but nobody can use it. Same debounce, cooldown and "recovered" rules
 * as container alerts, state kept under `domain:<url>`. Checked through the same
 * route as the UI's status dots (public address, then the proxy container).
 */
export async function evaluateDomainAlerts(snap: Snapshot): Promise<void> {
  const cfg = getConfig()
  if (!cfg.alertsEnabled || !cfg.alertDomains || !cfg.pingEnabled) return
  const targets = domainTargets(snap.services)
  const state = loadState()
  const results = targets.length
    ? await pingAll(targets.map((t) => t.url), snap.at, findProxyName(snap.services, getHosts()[0]?.name))
    : {}
  const rule = {
    debounceSamples: cfg.alertDebounceSamples,
    cooldownSec: cfg.alertCooldownSec,
    transitions: { down: true, unhealthy: false, recovered: cfg.alertTransitions.recovered },
  }
  const events: AlertEvent[] = []
  for (const t of targets) {
    const r = results[t.url]
    if (!r) continue
    const key = `domain:${t.url}`
    const { state: nextState, emit } = reduceAlertState(state[key] ?? emptyAlertState(), domainDown(r) ? 'down' : null, rule, snap.at)
    state[key] = nextState
    if (emit === 'down') events.push({ id: key, name: t.domain, host: t.host, kind: 'domain-down', from: t.service, to: domainLabel(r), at: snap.at })
    if (emit === 'recovered') events.push({ id: key, name: t.domain, host: t.host, kind: 'domain-recovered', from: t.service, to: domainLabel(r), at: snap.at })
  }
  // forget domains that are gone (route removed, container stopped)
  const live = new Set(targets.map((t) => `domain:${t.url}`))
  for (const id of Object.keys(state)) if (id.startsWith('domain:') && !live.has(id)) delete state[id]
  stateCache = state
  if (!events.length) return persist()
  for (const e of events) {
    const sent = await dispatch(e)
    for (const r of sent.filter((x) => !x.ok)) logger.warn('alerts', `notifier "${r.name}" failed to deliver "${e.kind}" alert for ${e.name}`, r.error)
  }
}
