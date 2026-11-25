import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newStackNameError, STACK_NAME_RE } from '../utils/stackName.ts'
import { requestSequence } from '../utils/requestSequence.ts'

const taken = { managed: ['media', 'git-app'], unmanaged: ['legacy'] }

test('a new stack name may not reuse an existing stack or a running compose project', () => {
  assert.equal(newStackNameError('fresh', taken), '')
  assert.match(newStackNameError('media', taken), /already exists/)
  assert.match(newStackNameError('  media  ', taken), /already exists/) // the form trims before it navigates
  assert.match(newStackNameError('legacy', taken), /already runs/)
})

test('a new stack name is lowercase only, because compose rejects capitals', () => {
  assert.match(newStackNameError('Media', taken), /lowercase/i)
  assert.notEqual(newStackNameError('my app', taken), '')
  assert.notEqual(newStackNameError('-media', taken), '')
  assert.notEqual(newStackNameError('../etc', taken), '')
  assert.ok(STACK_NAME_RE.test('a'.repeat(64)))
  assert.ok(!STACK_NAME_RE.test('a'.repeat(65)))
  assert.equal(newStackNameError('', taken), '') // empty: nothing to complain about yet
})

test('only the newest request may write its result', () => {
  const seq = requestSequence()
  const slow24h = seq.start()
  const fast1h = seq.start()
  assert.equal(slow24h(), false) // the late 24h answer is dropped
  assert.equal(fast1h(), true)
  seq.invalidate() // search box cleared: nothing in flight may land
  assert.equal(fast1h(), false)
})
