import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withEffective, withoutLocked } from '../server/utils/settings-locks-core.ts'

test('env-locked on: the page sees alerts ON, so the transitions under it are editable', () => {
  const saved = { alertsEnabled: false, alertTransitions: { down: true, unhealthy: true, recovered: false } }
  const view = withEffective(saved, { alertsEnabled: true }, { alerts: true })
  assert.equal(view.alertsEnabled, true) // was false: the form hid Down/Unhealthy/Recovered
  assert.deepEqual(view.alertTransitions, saved.alertTransitions) // the sub-options stay the saved, editable ones
  assert.equal(saved.alertsEnabled, false) // input untouched
})

test('unlocked fields show what was saved; numbers are mirrored too', () => {
  assert.equal(withEffective({ alertsEnabled: false }, { alertsEnabled: true }, { alerts: false }).alertsEnabled, false)
  assert.equal(withEffective({ collectorInterval: 30 }, { collectorInterval: 15 }, { collectorInterval: true }).collectorInterval, 15)
})

test('saving drops env-locked fields, keeps the rest (the transitions under a locked switch save)', () => {
  const patch = { alertsEnabled: true, alertTransitions: { down: true, unhealthy: true, recovered: true }, historyEnabled: false }
  const out = withoutLocked(patch, { alerts: true, historyEnabled: false })
  assert.equal('alertsEnabled' in out, false)
  assert.deepEqual(out.alertTransitions, { down: true, unhealthy: true, recovered: true })
  assert.equal(out.historyEnabled, false)
})
