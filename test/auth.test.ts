import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyHash, constantEquals, recordFailure, lockRemaining, FREE_FAILS, LOCK_BASE_MS, LOCK_MAX_MS, QUIET_MS } from '../server/utils/auth-core.ts'

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

// --- login rate limiting ---

test('rate limit: free attempts stay unlocked', () => {
  let s
  const t0 = 1_000_000
  for (let i = 0; i < FREE_FAILS - 1; i++) s = recordFailure(s, t0 + i)
  assert.equal(lockRemaining(s, t0 + 10), 0)
})

test('rate limit: locks at the threshold and doubles', () => {
  let s
  const t0 = 1_000_000
  for (let i = 0; i < FREE_FAILS; i++) s = recordFailure(s, t0)
  assert.equal(lockRemaining(s, t0), LOCK_BASE_MS)
  s = recordFailure(s, t0) // one more
  assert.equal(lockRemaining(s, t0), LOCK_BASE_MS * 2)
})

test('rate limit: lock caps at LOCK_MAX_MS', () => {
  let s
  const t0 = 1_000_000
  for (let i = 0; i < 30; i++) s = recordFailure(s, t0)
  assert.equal(lockRemaining(s, t0), LOCK_MAX_MS)
})

test('rate limit: lock expires with time', () => {
  let s
  const t0 = 1_000_000
  for (let i = 0; i < FREE_FAILS; i++) s = recordFailure(s, t0)
  assert.equal(lockRemaining(s, t0 + LOCK_BASE_MS + 1), 0)
})

test('rate limit: a quiet hour resets the fail count', () => {
  let s
  const t0 = 1_000_000
  for (let i = 0; i < FREE_FAILS; i++) s = recordFailure(s, t0)
  s = recordFailure(s, t0 + QUIET_MS + 1) // fresh slate → 1 fail, no lock
  assert.equal(s.fails, 1)
  assert.equal(lockRemaining(s, t0 + QUIET_MS + 2), 0)
})

test('rate limit: undefined state is allowed', () => {
  assert.equal(lockRemaining(undefined, 123), 0)
})
