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
  emptyLabelMemory,
  eventLabels,
  detectTransitions,
  reduceAlertState,
  badKind,
  domainTargets,
  domainDown,
  domainLabel,
  pruneServiceStates,
  offlineHosts,
  onHost,
} from './alerts-core'
import { pingAll } from './ping'
import { proxyForDomains } from './ping-core'
import { getHosts } from './hosts'
import { getNotifiers, type AlertEvent } from './notifiers'
import { silenceFor } from './silences'
import { serviceKey, silencedState, recoverySnoozeStep } from '../../shared/utils/silence.ts'
import { readSilences, writeSilences } from './silences'

// Effectful alerting layer: turns successive collector snapshots into debounced
// alert events, fans them out to webhook channels, and keeps a small in-app log.
// State + log persist under ${HOMEPORT_DATA_DIR}/alerts/ so homeport restarting
// doesn't re-page every already-down service. The decision logic is pure (alerts-core).

const LOG_CAP = 200
// Events held back by a pause or maintenance window, sent when it ends. Bounded:
// a long pause over a busy fleet keeps the newest.
const HELD_CAP = 50

const dir = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'alerts')
const stateFile = () => join(dir(), 'state.json')
const logFile = () => join(dir(), 'log.json')
const heldFile = () => join(dir(), 'held.json')

let stateCache: Record<string, AlertState> | null = null
let logCache: AlertEvent[] | null = null
let heldCache: AlertEvent[] | null = null
let prevStates = new Map<string, ServiceState>()
const labels = emptyLabelMemory() // what each alert says it moved between (alerts-core)
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

function loadHeld(): AlertEvent[] {
  if (heldCache) return heldCache
  try {
    const arr = JSON.parse(readFileSync(heldFile(), 'utf8'))
    heldCache = Array.isArray(arr) ? arr : []
  } catch {
    heldCache = []
  }
  return heldCache!
}

function persist() {
  if (!canWrite()) return
  try {
    mkdirSync(dir(), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify(stateCache ?? {}))
    writeFileSync(logFile(), JSON.stringify(logCache ?? []))
    writeFileSync(heldFile(), JSON.stringify(heldCache ?? []))
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
  // A pause or a maintenance window holds every kind, including update notices,
  // certificate warnings and update results. Many of those are said only once (the
  // caller has already marked them as told), so dropping them would lose them for
  // good: they go to Activity now and to the channels when the silence ends
  // (flushHeld). Down/recovered never get here while silenced: their state machine
  // starts over instead (shared/utils/silence.ts). The test button (record false)
  // always goes through: it is the user asking.
  if (record && silenceFor(null)) {
    const held = { ...event, held: true }
    const q = loadHeld()
    q.push(held)
    if (q.length > HELD_CAP) q.splice(0, q.length - HELD_CAP)
    recordActivity(held)
    return []
  }
  if (record) {
    const log = loadLog()
    log.push(event)
    if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP)
  }
  const results = await sendToChannels(event)
  if (record) persist()
  return results
}

/** Send what a pause or maintenance window held back, once it is over. */
export async function flushHeld(now = Date.now()): Promise<void> {
  const q = loadHeld()
  if (!q.length || silenceFor(null, now)) return
  heldCache = []
  persist()
  for (const e of q) await sendToChannels(e)
}

async function sendToChannels(event: AlertEvent): Promise<{ name: string; ok: boolean; error?: string }[]> {
  const cfg = getConfig()
  const notifiers = getNotifiers(
    cfg.alertChannels,
    cfg.smtpHost ? { host: cfg.smtpHost, port: cfg.smtpPort, secure: cfg.smtpSecure, user: cfg.smtpUser || undefined, pass: cfg.smtpPass || undefined, from: cfg.smtpFrom, to: cfg.smtpTo } : null,
  )
  return Promise.all(
    notifiers.map(async (n) => {
      try {
        const r = await n.send(event)
        return { name: n.name, ok: r.ok, error: r.error }
      } catch (e: any) {
        return { name: n.name, ok: false, error: e?.message || String(e) }
      }
    }),
  )
}

// Apps (by `<hostId>|<name>`) with a domain that failed its latest check, kept by
// evaluateDomainAlerts for the "until it recovers" snooze.
let domainBadOwners = new Set<string>()

/**
 * An "until it recovers" snooze ends once its app has been in trouble and is fine
 * again (recoverySnoozeStep): first it is marked as having seen trouble, then ended.
 */
function stepRecoverySnooze(key: string, appBad: boolean, now: number) {
  const s = readSilences(now)
  const sn = s.snoozes[key]
  const step = recoverySnoozeStep(sn, appBad, domainBadOwners.has(key))
  if (step === 'keep') return
  try {
    if (step === 'mark') return writeSilences({ ...s, snoozes: { ...s.snoozes, [key]: { ...sn!, sawBad: true } } })
    const { [key]: _gone, ...rest } = s.snoozes
    writeSilences({ ...s, snoozes: rest })
    recordActivity({ id: key, name: key.split('|').slice(1).join('|'), kind: 'silence', from: 'snoozed until it recovers', to: 'recovered, alerts back on', at: now })
  } catch {
    // best-effort: the snooze still ends at its latest time
  }
}

/** Log something to Activity without sending it anywhere (snoozes, pauses, resumes). */
export function recordActivity(event: AlertEvent): void {
  const log = loadLog()
  log.push(event)
  if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP)
  persist()
}

/** Called by the collector each tick: detect → debounce → notify. */
export async function evaluateAlerts(snap: Snapshot): Promise<void> {
  const cfg = getConfig()
  if (cfg.alertsEnabled) await flushHeld(snap.at)
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

  const keyOf = new Map(snap.services.map((sv) => [sv.id, serviceKey(sv.id, sv.name)]))
  for (const s of next) {
    if (s.noalert) continue
    // Silenced (snoozed, paused, or in a maintenance window): start from scratch
    // instead of muting, so the end of the silence neither floods nor stays quiet
    // about something still broken (see shared/utils/silence.ts).
    const key = keyOf.get(s.id) ?? null
    const kind = badKind(s)
    // "until it recovers": ends itself once the app was in trouble and is fine again
    if (key) stepRecoverySnooze(key, kind !== null, now)
    if (silenceFor(key, now)) {
      state[s.id] = silencedState(state[s.id], emptyAlertState())
      continue
    }

    const cur = state[s.id] ?? emptyAlertState()
    // A down alert went out before the silence and the app is fine now: close it,
    // so the channel isn't left with a down that never recovered.
    if (cur.heldOpen && kind === null) {
      state[s.id] = emptyAlertState()
      if (rule.transitions.recovered) events.push({ id: s.id, name: s.name, host: s.host, kind: 'recovered', from: 'down before the silence', to: s.state, at: now })
      continue
    }
    const { state: nextState, emit } = reduceAlertState(cur, kind, rule, now)
    // a fresh down after a silence settles the open one; keep the flag until then
    state[s.id] = cur.heldOpen && !emit ? { ...nextState, heldOpen: true } : nextState

    const ev = eventLabels(labels, s, transitions.get(s.id), emit)
    if (emit && ev) events.push({ id: s.id, name: s.name, host: s.host, kind: emit, from: ev.from, to: ev.to, at: now })
  }

  // A host homeport can't reach. With one host that means its socket proxy or
  // daemon is gone and homeport is blind, which used to page nobody: the host's
  // containers simply dropped out of the snapshot.
  const hostNames = new Map(getHosts().map((h) => [h.id, h.name]))
  const hostsSilenced = !!silenceFor(null, now)
  for (const [hostId, online] of Object.entries(snap.hostsOnline)) {
    const key = `host:${hostId}`
    if (hostsSilenced) {
      state[key] = silencedState(state[key], emptyAlertState())
      continue
    }
    const { state: nextState, emit } = reduceAlertState(state[key] ?? emptyAlertState(), online ? null : 'down', rule, now)
    state[key] = nextState
    if (emit === 'down' || emit === 'recovered') {
      const down = emit === 'down'
      events.push({
        id: key,
        name: `Docker on ${hostNames.get(hostId) || hostId}`,
        kind: emit,
        from: down ? 'reachable' : 'unreachable',
        to: down ? 'unreachable' : 'reachable',
        at: now,
      })
    }
  }

  // prune state for vanished services, keeping those of hosts that are offline
  pruneServiceStates(state, new Set(next.map((s) => s.id)), snap.hostsOnline)

  // Keep an offline host's last known states too, so whatever comes back stopped
  // is compared against how it was, not treated as new.
  const offline = offlineHosts(snap.hostsOnline)
  const kept = [...prevStates.values()].filter((p) => onHost(p.id, offline))
  prevStates = new Map([...kept, ...next].map((s) => [s.id, s]))
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
  const localHost = getHosts()[0]?.name
  const proxyOf = proxyForDomains(snap.services, localHost)
  const results = targets.length ? await pingAll(targets.map((t) => t.url), snap.at, (url) => proxyOf.get(url) ?? null) : {}
  const rule = {
    debounceSamples: cfg.alertDebounceSamples,
    cooldownSec: cfg.alertCooldownSec,
    transitions: { down: true, unhealthy: false, recovered: cfg.alertTransitions.recovered },
  }
  const events: AlertEvent[] = []
  const badOwners = new Set<string>()
  for (const t of targets) {
    const r = results[t.url]
    if (!r) continue
    if (domainDown(r)) badOwners.add(t.key)
    const key = `domain:${t.url}`
    // a domain is silent with the app that serves it
    if (silenceFor(t.key, snap.at)) {
      state[key] = silencedState(state[key], emptyAlertState())
      continue
    }
    if (state[key]?.heldOpen && !domainDown(r)) {
      state[key] = emptyAlertState()
      if (rule.transitions.recovered) events.push({ id: key, name: t.domain, host: t.host, kind: 'domain-recovered', from: t.service, to: domainLabel(r), at: snap.at })
      continue
    }
    const { state: nextState, emit } = reduceAlertState(state[key] ?? emptyAlertState(), domainDown(r) ? 'down' : null, rule, snap.at)
    state[key] = nextState
    if (emit === 'down') events.push({ id: key, name: t.domain, host: t.host, kind: 'domain-down', from: t.service, to: domainLabel(r), at: snap.at })
    if (emit === 'recovered') events.push({ id: key, name: t.domain, host: t.host, kind: 'domain-recovered', from: t.service, to: domainLabel(r), at: snap.at })
  }
  domainBadOwners = badOwners
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
