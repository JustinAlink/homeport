import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUsername, validateUsername, mintUser, MIN_USERNAME_LENGTH, isAdminLoginName, sessionAccess, sanitizeUsersBackup } from '../server/utils/users-core.ts'

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

test('isAdminLoginName: empty and "admin" (any case/spacing) mean the primary account', () => {
  for (const u of ['', '  ', 'admin', ' Admin ', 'ADMIN', undefined, null]) assert.equal(isAdminLoginName(u as any), true, String(u))
  for (const u of ['administrator', 'teammate', 'admin2']) assert.equal(isAdminLoginName(u), false, u)
})

test('sessionAccess: the account decides, on every request', () => {
  const t = 1_800_000_000_000
  const s = (uid?: string, iat = t) => ({ iat, ...(uid ? { uid } : {}) })
  assert.equal(sessionAccess(null, null, true), null)
  assert.equal(sessionAccess(s(), null, true), 'admin') // no account id: the primary admin
  assert.equal(sessionAccess(s('gone'), null, true), null) // deleted account
  assert.equal(sessionAccess(s('v'), {}, true), 'viewer') // a password viewer
  assert.equal(sessionAccess(s('a'), { role: 'admin', sso: { iss: 'i', sub: 'x' } }, true), 'admin') // SSO admin
  // signed out: sessions from before are void, a later sign-in works
  assert.equal(sessionAccess(s('v', t - 1), { signedOutAt: t }, true), null)
  assert.equal(sessionAccess(s('v', t + 1), { signedOutAt: t }, true), 'viewer')
  // single sign-on turned off: its accounts' sessions end, password viewers stay
  assert.equal(sessionAccess(s('a'), { role: 'admin', sso: { iss: 'i', sub: 'x' } }, false), null)
  assert.equal(sessionAccess(s('v'), {}, false), 'viewer')
  // a role in a token means nothing: only the account's role counts
  assert.equal(sessionAccess({ iat: t, uid: 'v', role: 'admin' } as any, { role: 'viewer' }, true), 'viewer')
})

test('backup: accounts come back, and no restore can mint a way in', () => {
  const hash = 'a'.repeat(32) + ':' + 'b'.repeat(128)
  const sso = { iss: 'https://auth.example.com', sub: 'abc' }
  const out = sanitizeUsersBackup([
    { id: '0123456789ab', username: 'fons', hash, createdAt: 1, lastLoginAt: 2 },
    { id: '0123456789ac', username: 'alice', hash: '', sso, role: 'admin', signedOutAt: 3 },
    { id: '0123456789ad', username: 'mallory', hash, role: 'admin' }, // a password account is never an admin
    { id: '0123456789ae', username: 'admin', hash }, // the primary account's name
    { id: 'not-hex-id!!', username: 'eve', hash },
    { id: '0123456789af', username: 'ghost', hash: '' }, // no password and no SSO: could never sign in
    { id: '0123456789b0', username: 'weak', hash: 'plaintext' }, // not a hash homeport makes
    { id: '0123456789ab', username: 'dup-id', hash }, // same id as fons
    { id: '0123456789b1', username: 'FONS', hash }, // same name as fons
  ])
  assert.deepEqual(out.map((u) => u.username), ['fons', 'alice', 'mallory'])
  assert.equal(out[0].hash, hash)
  assert.equal(out[1].role, 'admin') // an SSO admin stays one (its groups decide again at the next sign-in)
  assert.equal(out[1].signedOutAt, 3)
  assert.equal(out[2].role, undefined) // read-only
  assert.deepEqual(sanitizeUsersBackup('nope'), [])
})
