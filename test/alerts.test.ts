import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectTransitions,
  reduceAlertState,
  badKind,
  renderTemplate,
  emptyAlertState,
  type ServiceState,
  type AlertRuleConfig,
} from '../server/utils/alerts-core.ts'
import { eventText, buildBody } from '../server/utils/notifiers/format.ts'

const svc = (over: Partial<ServiceState>): ServiceState => ({
  id: 'h::c',
  name: 'web',
  state: 'running',
  health: null,
  ...over,
})

const rule = (over: Partial<AlertRuleConfig> = {}): AlertRuleConfig => ({
  debounceSamples: 3,
  cooldownSec: 0,
  transitions: { down: true, unhealthy: true, recovered: true },
  ...over,
})

// ---- detectTransitions ----

test('detectTransitions: running → exited = down', () => {
  const tr = detectTransitions([svc({ state: 'running' })], [svc({ state: 'exited' })])
  assert.equal(tr.length, 1)
  assert.equal(tr[0].kind, 'down')
  assert.equal(tr[0].to, 'exited')
})

test('detectTransitions: healthy → unhealthy', () => {
  const tr = detectTransitions([svc({ health: 'healthy' })], [svc({ health: 'unhealthy' })])
  assert.equal(tr[0].kind, 'unhealthy')
})

test('detectTransitions: exited → running = recovered', () => {
  const tr = detectTransitions([svc({ state: 'exited' })], [svc({ state: 'running' })])
  assert.equal(tr[0].kind, 'recovered')
})

test('detectTransitions: noalert is suppressed', () => {
  const tr = detectTransitions([svc({ state: 'running' })], [svc({ state: 'exited', noalert: true })])
  assert.equal(tr.length, 0)
})

test('detectTransitions: newly appeared / unchanged emit nothing', () => {
  assert.equal(detectTransitions([], [svc({ state: 'exited' })]).length, 0) // new
  assert.equal(detectTransitions([svc({ state: 'running' })], [svc({ state: 'running' })]).length, 0) // same
})

// ---- badKind ----

test('badKind', () => {
  assert.equal(badKind(svc({ state: 'running', health: null })), null)
  assert.equal(badKind(svc({ state: 'exited' })), 'down')
  assert.equal(badKind(svc({ state: 'running', health: 'unhealthy' })), 'unhealthy')
  assert.equal(badKind(svc({ state: 'restarting' })), null) // restarting tolerated
})

// ---- reduceAlertState debounce/cooldown/recovery ----

test('reduceAlertState: fires only after debounce threshold', () => {
  let s = emptyAlertState()
  const cfg = rule({ debounceSamples: 3 })
  let r = reduceAlertState(s, 'down', cfg, 1000)
  assert.equal(r.emit, null) // 1
  r = reduceAlertState(r.state, 'down', cfg, 2000)
  assert.equal(r.emit, null) // 2
  r = reduceAlertState(r.state, 'down', cfg, 3000)
  assert.equal(r.emit, 'down') // 3 → fire
  assert.equal(r.state.firing, true)
})

test('reduceAlertState: does not re-emit while firing (cooldown 0)', () => {
  let r = { state: { consecutiveBad: 3, firing: true, firedAt: 0, lastNotifiedAt: 3000 }, emit: null as any }
  r = reduceAlertState(r.state, 'down', rule({ cooldownSec: 0 }), 9_999_999)
  assert.equal(r.emit, null)
})

test('reduceAlertState: re-emits after cooldown elapses', () => {
  const cfg = rule({ cooldownSec: 60 })
  const s = { consecutiveBad: 5, firing: true, firedAt: 0, lastNotifiedAt: 1_000_000 }
  const tooSoon = reduceAlertState(s, 'down', cfg, 1_000_000 + 30_000)
  assert.equal(tooSoon.emit, null)
  const later = reduceAlertState(s, 'down', cfg, 1_000_000 + 61_000)
  assert.equal(later.emit, 'down')
})

test('reduceAlertState: recovery emits when it was firing', () => {
  const s = { consecutiveBad: 4, firing: true, firedAt: 0, lastNotifiedAt: 0 }
  const r = reduceAlertState(s, null, rule(), 5000)
  assert.equal(r.emit, 'recovered')
  assert.equal(r.state.firing, false)
})

test('reduceAlertState: respects disabled transition (down off)', () => {
  const cfg = rule({ debounceSamples: 1, transitions: { down: false, unhealthy: true, recovered: true } })
  const r = reduceAlertState(emptyAlertState(), 'down', cfg, 1000)
  assert.equal(r.emit, null)
  assert.equal(r.state.firing, true) // still tracks state, just doesn't notify
})

// ---- templates / channel bodies ----

test('renderTemplate: substitutes placeholders, blanks unknowns', () => {
  assert.equal(renderTemplate('{{name}} is {{kind}}', { name: 'web', kind: 'down' }), 'web is down')
  assert.equal(renderTemplate('{{nope}}!', {}), '!')
})

test('webhook buildBody: presets shape the payload', () => {
  const e = { id: 'h::c', name: 'web', host: 'vps', kind: 'down' as const, from: 'running', to: 'exited', at: 0 }
  assert.match(eventText(e), /web is down/)
  assert.deepEqual(JSON.parse(buildBody({ name: 'd', url: 'x', preset: 'discord' }, e).body), { content: eventText(e) })
  assert.deepEqual(JSON.parse(buildBody({ name: 's', url: 'x', preset: 'slack' }, e).body), { text: eventText(e) })
  const ntfy = buildBody({ name: 'n', url: 'x', preset: 'ntfy' }, e)
  assert.equal(ntfy.headers?.['content-type'], 'text/plain')
  const custom = buildBody({ name: 'c', url: 'x', preset: 'custom', template: '{"msg":"{{name}} {{to}}"}' }, e)
  assert.deepEqual(JSON.parse(custom.body), { msg: 'web exited' })
})
