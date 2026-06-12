import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseClientFrame, demoShellRespond, SHELL_CMD } from '../server/utils/terminal-core.ts'

test('parseClientFrame: input + resize accepted, junk rejected', () => {
  assert.deepEqual(parseClientFrame('{"type":"input","data":"ls\\r"}'), { type: 'input', data: 'ls\r' })
  assert.deepEqual(parseClientFrame('{"type":"resize","cols":120,"rows":40}'), { type: 'resize', cols: 120, rows: 40 })
  assert.equal(parseClientFrame('{"type":"resize","cols":-1,"rows":40}'), null)
  assert.equal(parseClientFrame('{"type":"resize","cols":99999,"rows":40}'), null)
  assert.equal(parseClientFrame('{"type":"exec","cmd":"rm -rf /"}'), null)
  assert.equal(parseClientFrame('not json'), null)
})

test('demo shell: known commands, unknown fallthrough, exit sentinel', () => {
  assert.match(demoShellRespond('ls', 'web'), /app\.js/)
  assert.equal(demoShellRespond('pwd', 'web'), '/app\r\n')
  assert.equal(demoShellRespond('hostname', 'jellyfin'), 'jellyfin\r\n')
  assert.equal(demoShellRespond('echo hi there', 'web'), 'hi there\r\n')
  assert.match(demoShellRespond('nmap', 'web'), /not found/)
  assert.equal(demoShellRespond('exit', 'web'), '__EXIT__')
})

test('shell cmd prefers bash with sh fallback', () => {
  assert.equal(SHELL_CMD[0], '/bin/sh')
  assert.match(SHELL_CMD[2], /bash.*exec sh/s)
})
