import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateRepoUrl,
  validateRef,
  authHeader,
  authArgs,
  redactSecrets,
  parseHeadLog,
  parseLsRemote,
} from '../server/utils/git-stacks-core.ts'

test('validateRepoUrl: http(s) only, no embedded credentials', () => {
  assert.equal(validateRepoUrl('https://github.com/user/repo'), 'https://github.com/user/repo')
  assert.equal(validateRepoUrl('  https://gitea.local/a/b.git '), 'https://gitea.local/a/b.git')
  assert.equal(validateRepoUrl('git@github.com:user/repo.git'), null)
  assert.equal(validateRepoUrl('ssh://git@host/repo'), null)
  assert.equal(validateRepoUrl('https://user:pass@github.com/a/b'), null)
  assert.equal(validateRepoUrl('https://token@github.com/a/b'), null)
  assert.equal(validateRepoUrl(''), null)
})

test('validateRef: sane branch/tag names only', () => {
  assert.equal(validateRef('main'), 'main')
  assert.equal(validateRef('release/v2.1'), 'release/v2.1')
  assert.equal(validateRef('feat_x-1.2'), 'feat_x-1.2')
  assert.equal(validateRef('-oops'), null)
  assert.equal(validateRef('a..b'), null)
  assert.equal(validateRef('has space'), null)
  assert.equal(validateRef(''), null)
})

test('authHeader/authArgs: basic x-access-token, scoped to the remote origin', () => {
  const h = authHeader('tok123')
  assert.equal(h, `AUTHORIZATION: basic ${Buffer.from('x-access-token:tok123').toString('base64')}`)
  const args = authArgs('https://github.com/a/b.git', 'tok123')
  assert.deepEqual(args.slice(0, 1), ['-c'])
  assert.match(args[1], /^http\.https:\/\/github\.com\/\.extraheader=AUTHORIZATION: basic /)
  assert.deepEqual(authArgs('https://github.com/a/b', null), [])
})

test('redactSecrets: scrubs token, its base64 form, and URL credentials', () => {
  const token = 'ghp_supersecret'
  const b64 = Buffer.from(`x-access-token:${token}`).toString('base64')
  assert.equal(redactSecrets(`fatal: unable to access 'https://x:${token}@github.com/a/b'`, token).includes(token), false)
  assert.equal(redactSecrets(`header AUTHORIZATION: basic ${b64}`, token).includes(b64), false)
  assert.equal(redactSecrets('https://user:pw@host/x', null), 'https://***@host/x')
  assert.equal(redactSecrets('normal line', 'tok'), 'normal line')
})

test('parseHeadLog: unit-separator format round-trip', () => {
  const out = 'a1b2c3d\x1fFix the thing\x1f2026-07-01T12:00:00+02:00\n'
  assert.deepEqual(parseHeadLog(out), { commit: 'a1b2c3d', subject: 'Fix the thing', committedAt: '2026-07-01T12:00:00+02:00' })
  assert.equal(parseHeadLog(''), null)
  assert.equal(parseHeadLog('garbage'), null)
})

test('parseLsRemote: extracts the sha', () => {
  assert.equal(parseLsRemote('e5f6a7b8c9d0e5f6a7b8c9d0e5f6a7b8c9d0e5f6\trefs/heads/main\n'), 'e5f6a7b8c9d0e5f6a7b8c9d0e5f6a7b8c9d0e5f6')
  assert.equal(parseLsRemote(''), null)
  assert.equal(parseLsRemote('not-a-sha refs/heads/main'), null)
})
