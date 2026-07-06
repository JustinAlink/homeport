import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeRelPath, isProtectedPath, looksBinary } from '../server/utils/files-core.ts'

test('safeRelPath: traversal and absolute paths rejected', () => {
  assert.equal(safeRelPath(''), '')
  assert.equal(safeRelPath('/'), '')
  assert.equal(safeRelPath('.env'), '.env')
  assert.equal(safeRelPath('config/settings.json'), 'config/settings.json')
  assert.equal(safeRelPath('  .env  '), '.env')
  assert.equal(safeRelPath('..'), null)
  assert.equal(safeRelPath('../etc/passwd'), null)
  assert.equal(safeRelPath('config/../../etc'), null)
  assert.equal(safeRelPath('config/./x'), null)
  assert.equal(safeRelPath('/etc/passwd'), null)
  assert.equal(safeRelPath('config//x'), null)
  assert.equal(safeRelPath('trailing/'), null)
  assert.equal(safeRelPath('back\\slash'), null)
  assert.equal(safeRelPath('nul\0byte'), null)
  assert.equal(safeRelPath('x'.repeat(256)), null)
})

test('isProtectedPath: .git internals only', () => {
  assert.equal(isProtectedPath('.git'), true)
  assert.equal(isProtectedPath('.git/config'), true)
  assert.equal(isProtectedPath('.github'), false)
  assert.equal(isProtectedPath('config/.git'), false) // nested repos are the user's business
  assert.equal(isProtectedPath('.env'), false)
})

test('looksBinary: null byte in the head', () => {
  assert.equal(looksBinary(new TextEncoder().encode('services:\n  app:\n')), false)
  assert.equal(looksBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d])), true)
  assert.equal(looksBinary(new Uint8Array(0)), false)
})
