import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routedPath } from '../server/utils/request-path-core.ts'

// What the middleware sees is h3's decoded event.path. These cases are the decoded
// forms of real attack URLs: /%61pi/backup arrives here as /api/backup, so it is
// checked as /api/backup.
test('request path: the decoded path is what gets checked', () => {
  assert.equal(routedPath('/api/backup'), '/api/backup')
  assert.equal(routedPath('/api/services?host=a&x=%2F'), '/api/services') // the query is not part of it
  assert.equal(routedPath('/'), '/')
  assert.equal(routedPath('/services/abc'), '/services/abc')
  assert.equal(routedPath('/_nuxt/entry.abc123.js'), '/_nuxt/entry.abc123.js')
})

test('request path: shapes no route uses are refused', () => {
  for (const bad of [
    '/api/stacks/media%2Fwebhook', // encoded slash, kept encoded by h3's decoder
    '/api/stacks/media%2fwebhook',
    '/api\\settings',
    '/api/%5Csettings',
    '/x/../api/backup',
    '/api/./settings',
    '/api/..',
    '/api/settings\0',
    '/api/a%00',
    'api/settings',
  ])
    assert.equal(routedPath(bad), null, bad)
})
