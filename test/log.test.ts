import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLevel, levelEnabled, serializeError, redactLog, formatLine } from '../server/utils/log-core.ts'

test('parseLevel: known levels, case-insensitive, fallback', () => {
  assert.equal(parseLevel('debug'), 'debug')
  assert.equal(parseLevel('WARN'), 'warn')
  assert.equal(parseLevel(' Error '), 'error')
  assert.equal(parseLevel('silent'), 'silent')
  assert.equal(parseLevel('nonsense'), 'info')
  assert.equal(parseLevel(undefined), 'info')
  assert.equal(parseLevel('', 'warn'), 'warn')
})

test('levelEnabled: threshold gating', () => {
  assert.equal(levelEnabled('info', 'debug'), false)
  assert.equal(levelEnabled('info', 'info'), true)
  assert.equal(levelEnabled('info', 'error'), true)
  assert.equal(levelEnabled('warn', 'info'), false)
  assert.equal(levelEnabled('debug', 'debug'), true)
  // silent threshold suppresses everything, including error
  assert.equal(levelEnabled('silent', 'error'), false)
})

test('serializeError: Error, code, string, object, nullish', () => {
  assert.equal(serializeError(new Error('boom')), 'boom')
  const e = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
  assert.equal(serializeError(e), 'refused (ECONNREFUSED)')
  assert.equal(serializeError('plain'), 'plain')
  assert.equal(serializeError({ message: 'objmsg' }), 'objmsg')
  assert.equal(serializeError({ a: 1 }), '{"a":1}')
  assert.equal(serializeError(null), '')
  assert.equal(serializeError(undefined), '')
})

test('redactLog: URL creds and key=value secrets', () => {
  assert.equal(redactLog('cloning https://user:ghp_secret@github.com/x'), 'cloning https://***@github.com/x')
  assert.match(redactLog('sent authorization: Bearer abc123'), /authorization: \*\*\*/i)
  assert.match(redactLog('token=ghp_abcdef'), /token=\*\*\*/)
  assert.match(redactLog('password: "hunter2"'), /password: "\*\*\*/)
  // ordinary text is untouched
  assert.equal(redactLog('collector tick ok services=12'), 'collector tick ok services=12')
})

test('formatLine: shape, level upcased, error appended, redacted', () => {
  const iso = '2026-07-06T00:00:00.000Z'
  assert.equal(formatLine(iso, 'info', 'collector', 'tick ok'), `${iso} INFO [collector] tick ok`)
  assert.equal(
    formatLine(iso, 'error', 'self-update', 'launch failed', new Error('no daemon')),
    `${iso} ERROR [self-update] launch failed — no daemon`,
  )
  // redaction runs over the whole formatted line
  assert.match(formatLine(iso, 'warn', 'git', 'x', 'https://u:p@h/r'), /https:\/\/\*\*\*@h\/r/)
})
