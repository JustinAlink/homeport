import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyProbe, capVerdict, CAP_REQUIREMENTS, PROBES } from '../server/utils/probe-core.ts'

test('classifyProbe: success means allowed', () => {
  assert.equal(classifyProbe(null), 'allowed')
})

test('classifyProbe: 403 is the proxy saying no', () => {
  assert.equal(classifyProbe({ statusCode: 403 }), 'blocked')
})

test('classifyProbe: daemon-level errors mean the proxy let it through', () => {
  assert.equal(classifyProbe({ statusCode: 404 }), 'allowed') // no such container
  assert.equal(classifyProbe({ statusCode: 500 }), 'allowed')
  assert.equal(classifyProbe({ statusCode: 401 }), 'allowed') // registry auth on distribution
})

test('classifyProbe: no status code (timeout, refused) is unknown', () => {
  assert.equal(classifyProbe({}), 'unknown')
  assert.equal(classifyProbe({ statusCode: undefined }), 'unknown')
})

test('capVerdict: allowed only when every requirement is allowed', () => {
  assert.equal(capVerdict({ post: 'allowed', exec: 'allowed' }, 'terminal'), 'allowed')
  assert.equal(capVerdict({ post: 'allowed', exec: 'blocked' }, 'terminal'), 'blocked')
  assert.equal(capVerdict({ post: 'allowed' }, 'terminal'), 'unknown') // exec unprobed
  assert.equal(capVerdict({ post: 'allowed', exec: 'unknown' }, 'terminal'), 'unknown')
})

test('capVerdict: blocked wins over unknown', () => {
  assert.equal(capVerdict({ post: 'unknown', images: 'blocked' }, 'updates'), 'blocked')
})

test('capVerdict: unknown capability name has no requirements → allowed', () => {
  assert.equal(capVerdict({}, 'nonsense'), 'allowed')
})

test('every capability requirement is a real probe', () => {
  for (const needs of Object.values(CAP_REQUIREMENTS)) {
    for (const n of needs) assert.ok((PROBES as readonly string[]).includes(n), n)
  }
})
