import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCidr,
  cidrsOverlap,
  findSubnetConflicts,
  detectNetworkError,
  subnetsFromComposeConfig,
  leftoverProjectNetworks,
  safeNetworkName,
} from '../server/utils/networks-core.ts'

test('safeNetworkName: docker network name rules', () => {
  assert.equal(safeNetworkName('shared-backend'), 'shared-backend')
  assert.equal(safeNetworkName('npm.network_2'), 'npm.network_2')
  assert.equal(safeNetworkName('  trimmed  '), 'trimmed')
  assert.equal(safeNetworkName('inner space'), null)
  assert.equal(safeNetworkName('-leading'), null)
  assert.equal(safeNetworkName('has/slash'), null)
  assert.equal(safeNetworkName(''), null)
  assert.equal(safeNetworkName('x'.repeat(64)), null)
})

test('parseCidr: v4 ranges + garbage', () => {
  const r = parseCidr('172.20.0.0/16')!
  assert.equal(r.end - r.start + 1n, 65536n)
  assert.equal(r.v6, false)
  // host bits are masked off
  assert.deepEqual(parseCidr('10.1.2.3/8')!.start, parseCidr('10.0.0.0/8')!.start)
  assert.equal(parseCidr('300.0.0.0/8'), null)
  assert.equal(parseCidr('10.0.0.0/33'), null)
  assert.equal(parseCidr('10.0.0.0'), null)
  assert.equal(parseCidr(''), null)
})

test('parseCidr: v6 incl. :: expansion', () => {
  const r = parseCidr('fdba:17c8:6c94::/64')!
  assert.equal(r.v6, true)
  assert.equal(r.end - r.start + 1n, 1n << 64n)
  assert.equal(parseCidr('fdba::1::2/64'), null)
  assert.equal(parseCidr('fdba::/129'), null)
})

test('cidrsOverlap: containment, identity, disjoint, family mismatch', () => {
  assert.equal(cidrsOverlap('172.20.0.0/16', '172.20.0.0/16'), true) // the pelican case
  assert.equal(cidrsOverlap('172.20.1.0/24', '172.20.0.0/16'), true)
  assert.equal(cidrsOverlap('172.23.0.0/16', '172.23.1.0/24'), true)
  assert.equal(cidrsOverlap('172.20.0.0/16', '172.21.0.0/16'), false)
  assert.equal(cidrsOverlap('172.20.0.0/16', 'fdba::/64'), false)
  assert.equal(cidrsOverlap('garbage', '172.20.0.0/16'), false)
})

test('findSubnetConflicts: names the overlapping network', () => {
  const networks = [
    { id: '1', name: 'bridge', driver: 'bridge', builtin: true, subnets: ['172.17.0.0/16'], containers: 3 },
    { id: '2', name: 'homeport_internal', driver: 'bridge', builtin: false, subnets: ['172.20.0.0/16'], containers: 2 },
    { id: '3', name: 'idle_net', driver: 'bridge', builtin: false, subnets: ['172.30.0.0/16'], containers: 0 },
  ]
  assert.deepEqual(findSubnetConflicts(['172.20.0.0/16'], networks), [
    { requested: '172.20.0.0/16', network: 'homeport_internal', subnet: '172.20.0.0/16', containers: 2 },
  ])
  assert.deepEqual(findSubnetConflicts(['10.99.0.0/24'], networks), [])
  assert.deepEqual(findSubnetConflicts([], networks), [])
})

test('detectNetworkError: overlap vs pool exhaustion', () => {
  assert.equal(
    detectNetworkError('Error response from daemon: invalid pool request: Pool overlaps with other one on this address space'),
    'overlap',
  )
  assert.equal(
    detectNetworkError('could not find an available, non-overlapping IPv4 address pool among the defaults'),
    'exhausted',
  )
  assert.equal(detectNetworkError('all predefined address pools have been fully subnetted'), 'exhausted')
  assert.equal(detectNetworkError('some other failure'), null)
})

test('leftoverProjectNetworks: label or name-prefix match, unused + non-builtin only', () => {
  const mk = (name: string, containers: number, project: string | null = null, builtin = false) => ({
    id: name,
    name,
    driver: 'bridge',
    builtin,
    subnets: [],
    containers,
    project,
  })
  const nets = [
    mk('bridge', 0, null, true), // builtin — never swept
    mk('pelican_nw', 0), // name prefix match, unused → swept
    mk('pelican_pelican-network', 0, 'pelican'), // label match → swept
    mk('pelican_busy', 2, 'pelican'), // still referenced → kept
    mk('pelicanish', 0), // no separator — not this project
    mk('other_default', 0, 'other'),
  ]
  assert.deepEqual(
    leftoverProjectNetworks(nets, 'pelican').map((n) => n.name),
    ['pelican_nw', 'pelican_pelican-network'],
  )
})

test('subnetsFromComposeConfig: ipam subnets across networks', () => {
  assert.deepEqual(
    subnetsFromComposeConfig({
      networks: {
        default: { ipam: { config: [{ subnet: '172.20.0.0/16' }] } },
        internal: { ipam: { config: [{ subnet: '10.5.0.0/24' }, { subnet: 'fd00::/64' }] } },
        plain: {},
      },
    }),
    ['172.20.0.0/16', '10.5.0.0/24', 'fd00::/64'],
  )
  assert.deepEqual(subnetsFromComposeConfig({}), [])
  assert.deepEqual(subnetsFromComposeConfig(null), [])
})
