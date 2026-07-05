import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAutoUpdateDue, planAutoUpdate, type AutoCandidate } from '../server/utils/auto-update-core.ts'

const c = (over: Partial<AutoCandidate>): AutoCandidate => ({
  id: 'abcdef123456',
  name: 'app',
  image: 'nginx:alpine',
  project: null,
  labels: {},
  ...over,
})

test('due: fires only in the configured hour, once per day', () => {
  assert.equal(isAutoUpdateDue(4, 4, undefined, '2026-07-05'), true)
  assert.equal(isAutoUpdateDue(4, 4, '2026-07-04', '2026-07-05'), true)
  assert.equal(isAutoUpdateDue(4, 4, '2026-07-05', '2026-07-05'), false) // already ran today
  assert.equal(isAutoUpdateDue(5, 4, undefined, '2026-07-05'), false) // wrong hour
})

test('plan: nothing opted in → empty plan', () => {
  const p = planAutoUpdate({ candidates: [c({})], targets: [], managedStacks: [] })
  assert.deepEqual(p, { stacks: [], directs: [], skipped: [] })
})

test('plan: container-name and project-name targets opt in', () => {
  const p = planAutoUpdate({
    candidates: [c({ name: 'web' }), c({ name: 'db', project: 'blog' })],
    targets: ['web', 'blog'],
    managedStacks: [],
  })
  assert.deepEqual(p.directs.map((d) => d.name), ['web', 'db'])
})

test('plan: managed-stack members roll up into one stack pull', () => {
  const p = planAutoUpdate({
    candidates: [c({ name: 'app', project: 'media' }), c({ name: 'db', project: 'media' })],
    targets: ['media'],
    managedStacks: ['media'],
  })
  assert.deepEqual(p.stacks, ['media'])
  assert.equal(p.directs.length, 0)
})

test('plan: unmanaged project members update directly', () => {
  const p = planAutoUpdate({
    candidates: [c({ name: 'app', project: 'legacy' })],
    targets: ['legacy'],
    managedStacks: ['media'],
  })
  assert.deepEqual(p.stacks, [])
  assert.equal(p.directs[0].name, 'app')
})

test('plan: hub.autoupdate=true opts in without a target', () => {
  const p = planAutoUpdate({
    candidates: [c({ labels: { 'hub.autoupdate': 'true' } })],
    targets: [],
    managedStacks: [],
  })
  assert.equal(p.directs.length, 1)
})

test('plan: hub.autoupdate=false wins over an explicit target', () => {
  const p = planAutoUpdate({
    candidates: [c({ name: 'web', labels: { 'hub.autoupdate': 'false' } })],
    targets: ['web'],
    managedStacks: [],
  })
  assert.equal(p.directs.length, 0)
  assert.deepEqual(p.skipped, [{ name: 'web', reason: 'label-optout' }])
})

test('plan: homeport itself is skipped even when opted in', () => {
  const p = planAutoUpdate({
    candidates: [c({ name: 'homeport', id: 'deadbeef1234full' })],
    targets: ['homeport'],
    managedStacks: [],
    selfIdPrefix: 'deadbeef1234',
  })
  assert.equal(p.directs.length, 0)
  assert.deepEqual(p.skipped, [{ name: 'homeport', reason: 'self' }])
})
