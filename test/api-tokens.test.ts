import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashToken, mintToken, matchToken, scopeAllows, TOKEN_PREFIX } from '../server/utils/api-tokens-core.ts'

test('mintToken: prefixed high-entropy token, hash-only record, scope normalized', () => {
  const { token, record } = mintToken('junibot', 'full', 1000)
  assert.ok(token.startsWith(TOKEN_PREFIX))
  assert.ok(token.length > 20)
  assert.equal(record.name, 'junibot')
  assert.equal(record.scope, 'full')
  assert.equal(record.hash, hashToken(token))
  assert.ok(record.prefix.startsWith(TOKEN_PREFIX))
  assert.notEqual(record.prefix, token) // display prefix, not the whole secret
  assert.equal(record.createdAt, 1000)
  // empty name falls back; unknown scope defaults to read
  assert.equal(mintToken('', 'nope' as any, 0).record.name, 'token')
  assert.equal(mintToken('x', 'nope' as any, 0).record.scope, 'read')
})

test('matchToken: finds by hash, rejects wrong/garbage/non-prefixed', () => {
  const a = mintToken('a', 'read', 0)
  const b = mintToken('b', 'full', 0)
  const records = [a.record, b.record]
  assert.equal(matchToken(a.token, records)?.id, a.record.id)
  assert.equal(matchToken(b.token, records)?.scope, 'full')
  assert.equal(matchToken('hp_wrongwrongwrong', records), null)
  assert.equal(matchToken('not-a-homeport-token', records), null) // no prefix
  assert.equal(matchToken('', records), null)
  assert.equal(matchToken(a.token, []), null)
})

test('scopeAllows: full = everything; read = safe GETs minus secret exports', () => {
  // full scope: any method, any path
  assert.equal(scopeAllows('full', 'POST', '/api/control'), true)
  assert.equal(scopeAllows('full', 'GET', '/api/backup'), true)
  // read scope: GET/HEAD only
  assert.equal(scopeAllows('read', 'GET', '/api/services'), true)
  assert.equal(scopeAllows('read', 'HEAD', '/api/services'), true)
  assert.equal(scopeAllows('read', 'POST', '/api/services'), false)
  assert.equal(scopeAllows('read', 'DELETE', '/api/tokens'), false)
  // read scope must not export secrets even via GET
  assert.equal(scopeAllows('read', 'GET', '/api/backup'), false)
  // read scope (viewer sessions too) must not reach user-account management
  assert.equal(scopeAllows('read', 'GET', '/api/users'), false)
  assert.equal(scopeAllows('full', 'GET', '/api/users'), true)
})

test('scopeAllows: read scope cannot reach secrets through plain GETs', () => {
  // container files: /data/auth.json holds the session secret, so a read token
  // here could forge an admin cookie
  assert.equal(scopeAllows('read', 'GET', '/api/containers/file'), false)
  assert.equal(scopeAllows('read', 'GET', '/api/containers/files'), false)
  // container environments and settings (proxy passwords, webhook URLs)
  assert.equal(scopeAllows('read', 'GET', '/api/env'), false)
  assert.equal(scopeAllows('read', 'GET', '/api/settings'), false)
  // what read tokens exist for still works (junibot's contract)
  for (const p of ['/api/services', '/api/stats', '/api/pings', '/api/logs', '/api/alerts', '/api/containers/abc/mounts'])
    assert.equal(scopeAllows('read', 'GET', p), true, p)
})

test('scopeAllows: read scope cannot read stack files, but still sees stacks', () => {
  // compose file contents and anything in the stack folder (.env)
  assert.equal(scopeAllows('read', 'GET', '/api/stacks/media'), false)
  assert.equal(scopeAllows('read', 'GET', '/api/stacks/media/'), false)
  assert.equal(scopeAllows('read', 'GET', '/api/stacks/media/file'), false)
  assert.equal(scopeAllows('read', 'GET', '/api/stacks/media/files'), false)
  assert.equal(scopeAllows('read', 'HEAD', '/api/stacks/media/file'), false)
  // the list, mounts and git info carry no file contents
  assert.equal(scopeAllows('read', 'GET', '/api/stacks'), true)
  assert.equal(scopeAllows('read', 'GET', '/api/stacks/media/mounts'), true)
  assert.equal(scopeAllows('read', 'GET', '/api/stacks/media/git'), true)
  // admins and full tokens unaffected
  assert.equal(scopeAllows('full', 'GET', '/api/stacks/media/file'), true)
})

test('scopeAllows: read scope may POST to the MCP endpoint and nowhere else', () => {
  // MCP sends every question as a POST; its tools only read
  assert.equal(scopeAllows('read', 'POST', '/api/mcp'), true)
  assert.equal(scopeAllows('read', 'post', '/api/mcp'), true)
  // only that exact path: no sub-path, look-alike or trailing slash rides on it
  for (const p of ['/api/mcp/', '/api/mcp/x', '/api/mcpx', '/api/mcp-admin', '/api/MCP', '/mcp'])
    assert.equal(scopeAllows('read', 'POST', p), false, p)
  // and only POST: no other write method reaches it
  for (const m of ['PUT', 'PATCH', 'DELETE'])
    assert.equal(scopeAllows('read', m, '/api/mcp'), false, m)
  // the read-only rule still holds everywhere else
  for (const p of ['/api/control', '/api/recreate', '/api/stacks/media', '/api/settings', '/api/env', '/api/tokens', '/api/backup', '/api/exposure/acks', '/api/services'])
    assert.equal(scopeAllows('read', 'POST', p), false, p)
})
