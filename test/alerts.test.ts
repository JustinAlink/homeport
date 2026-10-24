import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectTransitions,
  reduceAlertState,
  badKind,
  renderTemplate,
  emptyAlertState,
  domainTargets,
  domainDown,
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

test('webhook buildBody: apprise maps kind→type and passes stateless urls', () => {
  const base = { id: 'h::c', name: 'web', host: 'vps', from: 'running', to: 'exited', at: 0 }
  // down → failure; stateless urls included when provided
  const down = JSON.parse(buildBody({ name: 'a', url: 'x', preset: 'apprise', urls: 'pover://u@t' }, { ...base, kind: 'down' }).body)
  assert.equal(down.type, 'failure')
  assert.equal(down.urls, 'pover://u@t')
  assert.equal(down.body, eventText({ ...base, kind: 'down' }))
  // recovered → success; no urls key when omitted (stateful config key in the endpoint)
  const rec = JSON.parse(buildBody({ name: 'a', url: 'x', preset: 'apprise' }, { ...base, kind: 'recovered' }).body)
  assert.equal(rec.type, 'success')
  assert.equal('urls' in rec, false)
  // unhealthy → warning; update → info
  assert.equal(JSON.parse(buildBody({ name: 'a', url: 'x', preset: 'apprise' }, { ...base, kind: 'unhealthy' }).body).type, 'warning')
  assert.equal(JSON.parse(buildBody({ name: 'a', url: 'x', preset: 'apprise' }, { ...base, kind: 'update' }).body).type, 'info')
})

test('eventText: update kind reads as an update, not a failure', () => {
  const text = eventText({ id: 'default|ghcr.io/x/y:latest', name: 'jellyfin', host: 'vps', kind: 'update', from: 'ghcr.io/x/y:latest', to: 'sha256:abc', at: 0 })
  assert.match(text, /jellyfin/)
  assert.match(text, /image update available/)
  assert.match(text, /on vps/)
})

test('domain alerts watch running, non-excluded containers, one entry per URL', () => {
  const svc = (id: string, state: string, urls: string[], noalert = false) => ({ id, displayName: id, state, noalert, domains: urls.map((u) => ({ domain: u, url: `https://${u}` })) })
  const t = domainTargets([
    svc('web', 'running', ['a.example', 'b.example']),
    svc('stopped', 'exited', ['c.example']), // its own "down" alert covers it
    svc('quiet', 'running', ['d.example'], true),
    svc('web2', 'running', ['a.example']), // same URL twice: watched once
  ])
  assert.deepEqual(t.map((x) => x.domain), ['a.example', 'b.example'])
  assert.equal(t[0].service, 'web')
})

test('a domain is down on 5xx or no answer, not on 4xx (a login wall is the app answering)', () => {
  assert.equal(domainDown({ status: 0 }), true)
  assert.equal(domainDown({ status: 502 }), true)
  assert.equal(domainDown({ status: 401 }), false)
  assert.equal(domainDown({ status: 404 }), false)
  assert.equal(domainDown({ status: 200 }), false)
})

test('domain alert texts say which site and what it answers', () => {
  assert.match(eventText({ id: 'domain:x', name: 'blog.example.com', kind: 'domain-down', from: 'ghost', to: 'HTTP 502', at: 0 }), /blog\.example\.com is not answering properly \(HTTP 502\), served by ghost/)
  assert.match(eventText({ id: 'domain:x', name: 'blog.example.com', kind: 'domain-recovered', from: 'HTTP 502', to: 'HTTP 200', at: 0 }), /blog\.example\.com answers again \(HTTP 200\)/)
})
