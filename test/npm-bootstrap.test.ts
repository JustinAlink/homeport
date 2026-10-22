import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  passwordFromBytes,
  parseToken,
  passwordChangeBody,
  tokenBody,
  npmBaseUrl,
  credsSettingsPatch,
  DEFAULT_NPM_IDENTITY,
  npmLoginError,
} from '../server/utils/proxy-admin/npm-bootstrap-core.ts'

test('passwordFromBytes: strong, deterministic, policy-safe', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
  const pw = passwordFromBytes(bytes)
  assert.equal(pw, passwordFromBytes(bytes)) // deterministic given the same bytes
  assert.ok(pw.length >= 8, 'at least 8 chars')
  assert.match(pw, /[a-zA-Z]/, 'has a letter')
  assert.match(pw, /[0-9]/, 'has a digit')
  assert.match(pw, /^[A-Za-z0-9]+$/, 'copy-paste safe alphabet') // - and _ stripped
})

test('passwordFromBytes: forces variety when bytes map to all-letters or all-digits', () => {
  // all-zero bytes → base64url 'AAAA…' (no digit) → a '7' is appended
  const pw = passwordFromBytes(new Uint8Array(18))
  assert.match(pw, /[0-9]/)
  assert.match(pw, /[a-zA-Z]/)
})

test('parseToken: accepts a non-empty string token, rejects the rest', () => {
  assert.equal(parseToken({ token: 'abc' }), 'abc')
  assert.equal(parseToken({ token: '' }), null)
  assert.equal(parseToken({}), null)
  assert.equal(parseToken(null), null)
  assert.equal(parseToken({ token: 123 }), null)
})

test('request bodies are the shapes NPM expects', () => {
  assert.deepEqual(JSON.parse(tokenBody('me@x', 'pw')), { identity: 'me@x', secret: 'pw' })
  assert.deepEqual(JSON.parse(passwordChangeBody('old', 'new')), { type: 'password', current: 'old', secret: 'new' })
})

test('npmBaseUrl: defaults to the in-network service, trims trailing slashes', () => {
  assert.equal(npmBaseUrl(undefined), 'http://nginx-proxy-manager:81')
  assert.equal(npmBaseUrl(''), 'http://nginx-proxy-manager:81')
  assert.equal(npmBaseUrl('http://npm:81/'), 'http://npm:81')
  assert.equal(npmBaseUrl('  http://npm:81//  '), 'http://npm:81')
})

test('credsSettingsPatch: wires provider + proxy-admin on', () => {
  const p = credsSettingsPatch('http://npm:81/', DEFAULT_NPM_IDENTITY, 'secret')
  assert.equal(p.npmApiUrl, 'http://npm:81')
  assert.equal(p.npmApiIdentity, 'admin@example.com')
  assert.equal(p.npmApiSecret, 'secret')
  assert.equal(p.domainProvider, 'npm')
  assert.equal(p.allowProxyAdmin, true)
})

test('npmLoginError: an account with 2FA gets told why, and what to do instead', () => {
  const twoFa = npmLoginError({ ok: true, status: 200, data: { requires_2fa: true, challenge_token: 'x' } })
  assert.match(twoFa, /two-factor/)
  assert.match(twoFa, /its own NPM user/)
  assert.match(npmLoginError({ ok: false, status: 401 }), /rejected the email or password/)
  assert.match(npmLoginError({ ok: false, status: 0, error: 'ECONNREFUSED' }), /ECONNREFUSED/)
})
