import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMount, aggregateStackMounts } from '../server/utils/mounts-core.ts'

test('classifyMount: named volume (the searxng case — config in a volume, not the compose file)', () => {
  const m = classifyMount(
    { type: 'volume', name: 'searxng-etc-searxng', destination: '/etc/searxng', rw: true },
    '/stacks/searxng',
  )
  assert.deepEqual(m, {
    kind: 'volume',
    name: 'searxng-etc-searxng',
    anonymous: false,
    dest: '/etc/searxng',
    rw: true,
    services: [],
    container: '',
  })
})

test('classifyMount: anonymous (hash-named) volume is flagged', () => {
  const hash = 'a'.repeat(64)
  const m = classifyMount({ type: 'volume', name: hash, destination: '/data', rw: true }, '/stacks/app')
  assert.equal(m?.kind, 'volume')
  assert.equal((m as any).anonymous, true)
})

test('classifyMount: bind inside the stack dir → editable (bind-internal, relative path)', () => {
  const m = classifyMount({ type: 'bind', source: '/stacks/app/config', destination: '/config', rw: true }, '/stacks/app')
  assert.deepEqual(m, { kind: 'bind-internal', rel: 'config', dest: '/config', rw: true, services: [], container: '' })
})

test('classifyMount: bind of the stack root itself → rel ""', () => {
  const m = classifyMount({ type: 'bind', source: '/stacks/app/', destination: '/app', rw: true }, '/stacks/app')
  assert.equal(m?.kind, 'bind-internal')
  assert.equal((m as any).rel, '')
})

test('classifyMount: bind outside the stack dir → bind-external with the host path', () => {
  const m = classifyMount({ type: 'bind', source: '/mnt/media', destination: '/media', rw: false }, '/stacks/app')
  assert.deepEqual(m, { kind: 'bind-external', source: '/mnt/media', dest: '/media', rw: false, services: [], container: '' })
})

test('classifyMount: a sibling dir sharing a name prefix is NOT treated as internal', () => {
  const m = classifyMount({ type: 'bind', source: '/stacks/app-data/x', destination: '/x', rw: true }, '/stacks/app')
  assert.equal(m?.kind, 'bind-external')
})

test('classifyMount: tmpfs, destination-less, and unnamed volumes are dropped', () => {
  assert.equal(classifyMount({ type: 'tmpfs', destination: '/tmp', rw: true }, '/stacks/app'), null)
  assert.equal(classifyMount({ type: 'bind', source: '/x', destination: '', rw: true }, '/stacks/app'), null)
  assert.equal(classifyMount({ type: 'volume', destination: '/data', rw: true }, '/stacks/app'), null)
})

test('classifyMount: unknown stack dir → binds all fall back to external', () => {
  const m = classifyMount({ type: 'bind', source: '/stacks/app/config', destination: '/config', rw: true }, '')
  assert.equal(m?.kind, 'bind-external')
})

test('aggregateStackMounts: dedupes across services, collects service names, orders internal→volume→external', () => {
  const rows = aggregateStackMounts(
    [
      {
        service: 'web',
        id: 'default::web123',
        mounts: [
          { type: 'bind', source: '/mnt/media', destination: '/media', rw: false },
          { type: 'volume', name: 'app_db', destination: '/var/lib/db', rw: true },
          { type: 'bind', source: '/stacks/app/config', destination: '/config', rw: true },
        ],
      },
      {
        service: 'worker',
        id: 'default::worker456',
        mounts: [
          { type: 'bind', source: '/mnt/media', destination: '/media', rw: false }, // same as web → deduped
          { type: 'tmpfs', destination: '/tmp', rw: true },
        ],
      },
    ],
    '/stacks/app',
  )
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['bind-internal', 'volume', 'bind-external'],
  )
  const ext = rows.find((r) => r.kind === 'bind-external')!
  assert.deepEqual(ext.services, ['web', 'worker'])
  // the shared /media mount records the FIRST container that has it (web), so the
  // client can open the file editor for it
  assert.equal(ext.container, 'default::web123')
})
