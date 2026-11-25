import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitServiceId, uniqueIds } from '../server/utils/service-id.ts'

test('splitServiceId', () => {
  assert.deepEqual(splitServiceId('vps-1::abc123'), { hostId: 'vps-1', containerId: 'abc123' })
  assert.deepEqual(splitServiceId('abc123'), { hostId: 'default', containerId: 'abc123' })
  // only the first :: splits (container ids never contain ::, but be safe)
  assert.deepEqual(splitServiceId('h::a::b'), { hostId: 'h', containerId: 'a::b' })
})

test('uniqueIds: colliding host slugs get a suffix, the first keeps its id', () => {
  assert.deepEqual(uniqueIds(['pi', 'pi', 'nas', 'pi']), ['pi', 'pi-2', 'nas', 'pi-3'])
  // a real host already called pi-2 is not stolen
  assert.deepEqual(uniqueIds(['pi', 'pi-2', 'pi']), ['pi', 'pi-2', 'pi-3'])
  assert.deepEqual(uniqueIds(['a', 'b']), ['a', 'b'])
})
