import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUsername, validateUsername, mintUser, MIN_USERNAME_LENGTH } from '../server/utils/users-core.ts'

test('normalizeUsername: trims and lowercases', () => {
  assert.equal(normalizeUsername('  Teammate  '), 'teammate')
  assert.equal(normalizeUsername('ADMIN'), 'admin')
  assert.equal(normalizeUsername('Mixed.Case-1'), 'mixed.case-1')
})

test('validateUsername: length, charset, reserved-name rules', () => {
  assert.equal(validateUsername('ab'), `username must be ${MIN_USERNAME_LENGTH}-32 characters`)
  assert.equal(validateUsername('a'.repeat(33)), `username must be ${MIN_USERNAME_LENGTH}-32 characters`)
  assert.equal(validateUsername('a'.repeat(32)), null)
  assert.equal(validateUsername('bob'), null)
  assert.equal(validateUsername('Bob'), null) // normalized before checking
  assert.ok(validateUsername('bad name'))
  assert.ok(validateUsername('bad$name'))
  assert.equal(validateUsername('valid_name.1-2'), null)
  assert.equal(validateUsername('admin'), '"admin" is reserved for the primary account')
  assert.equal(validateUsername('ADMIN'), '"admin" is reserved for the primary account')
  assert.equal(validateUsername('  admin  '), '"admin" is reserved for the primary account')
})

test('mintUser: id present, username normalized, hash passed through, createdAt stamped', () => {
  const rec = mintUser('Teammate ', 'salt:hash', 5000)
  assert.ok(rec.id)
  assert.equal(rec.id.length, 12) // randomBytes(6).toString('hex')
  assert.equal(rec.username, 'teammate')
  assert.equal(rec.hash, 'salt:hash')
  assert.equal(rec.createdAt, 5000)
  assert.equal(rec.lastLoginAt, undefined)
  // distinct ids across calls
  const rec2 = mintUser('other', 'salt:hash2', 5000)
  assert.notEqual(rec.id, rec2.id)
})
