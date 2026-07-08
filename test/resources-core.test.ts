import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coresToQuota,
  quotaToCores,
  parseByteSize,
  formatByteSize,
  buildUpdateFields,
  mapResourcesError,
  CPU_PERIOD_US,
} from '../server/utils/resources-core.ts'

test('coresToQuota / quotaToCores round-trip at the fixed period', () => {
  assert.deepEqual(coresToQuota(2), { cpuQuota: 200000, cpuPeriod: CPU_PERIOD_US })
  assert.deepEqual(coresToQuota(0.5), { cpuQuota: 50000, cpuPeriod: CPU_PERIOD_US })
  assert.equal(coresToQuota(0), null)
  assert.equal(coresToQuota(undefined), null)
  assert.equal(coresToQuota(null), null)

  assert.equal(quotaToCores(200000, 100000), 2)
  assert.equal(quotaToCores(50000, 100000), 0.5)
  assert.equal(quotaToCores(0, 100000), null) // 0 = unlimited, not "0 cores"
  assert.equal(quotaToCores(200000, 0), null)
  assert.equal(quotaToCores(undefined, undefined), null)
})

test('parseByteSize: parses common suffixes, rejects garbage', () => {
  assert.equal(parseByteSize('512m'), 512 * 1024 ** 2)
  assert.equal(parseByteSize('2g'), 2 * 1024 ** 3)
  assert.equal(parseByteSize('1024k'), 1024 * 1024)
  assert.equal(parseByteSize('100'), 100)
  assert.equal(parseByteSize(2048), 2048)
  assert.equal(parseByteSize(''), null)
  assert.equal(parseByteSize(undefined), null)
  assert.equal(parseByteSize(null), null)
  assert.throws(() => parseByteSize('abc'), /could not parse size/)
  assert.throws(() => parseByteSize('-5m'), /could not parse size/)
})

test('parseByteSize: an explicit zero is rejected, not silently treated as unlimited', () => {
  // The daemon's own update path ignores a 0 byte value the same as an absent
  // field, so accepting it here would report success while the old limit
  // stays in place — reject it instead of pretending it clears anything.
  assert.throws(() => parseByteSize(0), /recreate the container/)
  assert.throws(() => parseByteSize('0'), /recreate the container/)
  // ...unless the caller opts in (memorySwap: 0 has a sane meaning, "-1").
  assert.equal(parseByteSize(0, { allowZero: true }), 0)
  assert.equal(parseByteSize('0', { allowZero: true }), 0)
})

test('formatByteSize: shortest round-tripping unit', () => {
  assert.equal(formatByteSize(2 * 1024 ** 3), '2g')
  assert.equal(formatByteSize(512 * 1024 ** 2), '512m')
  assert.equal(formatByteSize(1024), '1k')
  assert.equal(formatByteSize(100), '100')
  assert.equal(formatByteSize(0), '')
  assert.equal(formatByteSize(undefined), '')
  // round-trip
  assert.equal(parseByteSize(formatByteSize(768 * 1024 ** 2)), 768 * 1024 ** 2)
})

test('buildUpdateFields: cpus convenience field converts to quota/period', () => {
  assert.deepEqual(buildUpdateFields({ cpus: 1.5 }), { CpuQuota: 150000, CpuPeriod: 100000 })
})

test('buildUpdateFields: raw cpuQuota/cpuPeriod pass through when cpus omitted', () => {
  assert.deepEqual(buildUpdateFields({ cpuQuota: 200000, cpuPeriod: 100000 }), { CpuQuota: 200000, CpuPeriod: 100000 })
})

test('buildUpdateFields: memory sets MemorySwap to -1 by default (sidesteps daemon constraint)', () => {
  assert.deepEqual(buildUpdateFields({ memory: '512m' }), { Memory: 512 * 1024 ** 2, MemorySwap: -1 })
})

test('buildUpdateFields: explicit memorySwap is respected instead of the -1 default', () => {
  assert.deepEqual(buildUpdateFields({ memory: '512m', memorySwap: '1g' }), { Memory: 512 * 1024 ** 2, MemorySwap: 1024 ** 3 })
})

test('buildUpdateFields: memoryReservation and cpusetCpus pass through', () => {
  assert.deepEqual(buildUpdateFields({ memoryReservation: '256m', cpusetCpus: '0-1' }), {
    MemoryReservation: 256 * 1024 ** 2,
    CpusetCpus: '0-1',
  })
})

test('buildUpdateFields: only provided fields are included (0 is not sent as clear)', () => {
  const out = buildUpdateFields({ cpus: 1 })
  assert.equal('Memory' in out, false)
  assert.equal('MemoryReservation' in out, false)
  assert.equal('MemorySwap' in out, false)
})

test('buildUpdateFields: rejects invalid input', () => {
  assert.throws(() => buildUpdateFields({ cpus: -1 }), /positive number/)
  assert.throws(() => buildUpdateFields({ cpusetCpus: 'nope!' }), /cpusetCpus/)
  assert.throws(() => buildUpdateFields({ memory: 'abc' }), /could not parse size/)
  assert.throws(() => buildUpdateFields({}), /no resource fields/)
})

test('buildUpdateFields: an explicit 0 for cpus/memory/memoryReservation is rejected, not treated as "clear"', () => {
  // These can't actually clear a limit through docker update (the daemon
  // ignores a 0 value the same as an absent field), so accepting them would
  // report success while silently leaving the old limit in place.
  assert.throws(() => buildUpdateFields({ cpus: 0 }), /recreate the container/)
  assert.throws(() => buildUpdateFields({ memory: 0 }), /recreate the container/)
  assert.throws(() => buildUpdateFields({ memory: '0' }), /recreate the container/)
  assert.throws(() => buildUpdateFields({ memoryReservation: 0 }), /recreate the container/)
  assert.throws(() => buildUpdateFields({ memoryReservation: '0' }), /recreate the container/)
})

test('buildUpdateFields: memorySwap of 0/blank means "-1" (unlimited), not "clear" — it\'s the one field where 0 is sane', () => {
  assert.deepEqual(buildUpdateFields({ memorySwap: 0 }), { MemorySwap: -1 })
  assert.deepEqual(buildUpdateFields({ memorySwap: '0' }), { MemorySwap: -1 })
})

test('mapResourcesError: classifies daemon validation vs generic failure', () => {
  assert.deepEqual(mapResourcesError(new Error('Minimum memory limit allowed is 4MB')), {
    statusCode: 400,
    statusMessage: 'Minimum memory limit allowed is 4MB',
  })
  assert.equal(mapResourcesError(new Error('socket hang up')).statusCode, 502)
  assert.equal(mapResourcesError(new Error('<html>Bad Request</html> 400 invalid')).statusCode, 400)
})
