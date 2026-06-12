import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyHash, constantEquals } from '../server/utils/auth-core.ts'

test('hashPassword: salted, verifies, rejects wrong password', () => {
  const stored = hashPassword('correct horse')
  assert.match(stored, /^[0-9a-f]+:[0-9a-f]+$/)
  assert.equal(verifyHash('correct horse', stored), true)
  assert.equal(verifyHash('wrong', stored), false)
})

test('hashPassword: different salt each time (same input → different stored)', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'))
})

test('verifyHash: handles missing/garbage stored value', () => {
  assert.equal(verifyHash('x', undefined), false)
  assert.equal(verifyHash('x', ''), false)
  assert.equal(verifyHash('x', 'nocolon'), false)
})

test('constantEquals', () => {
  assert.equal(constantEquals('abc', 'abc'), true)
  assert.equal(constantEquals('abc', 'abd'), false)
  assert.equal(constantEquals('abc', 'abcd'), false) // length mismatch, no throw
})
