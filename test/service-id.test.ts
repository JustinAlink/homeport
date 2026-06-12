import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitServiceId } from '../server/utils/service-id.ts'

test('splitServiceId', () => {
  assert.deepEqual(splitServiceId('vps-1::abc123'), { hostId: 'vps-1', containerId: 'abc123' })
  assert.deepEqual(splitServiceId('abc123'), { hostId: 'default', containerId: 'abc123' })
  // only the first :: splits (container ids never contain ::, but be safe)
  assert.deepEqual(splitServiceId('h::a::b'), { hostId: 'h', containerId: 'a::b' })
})
