import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createContainerLock, ContainerBusyError } from '../server/utils/container-lock-core.ts'

test('a second operation on the same container is refused while the first runs', async () => {
  const lock = createContainerLock()
  let release!: () => void
  const first = lock.run(['h::app'], 'an update', () => new Promise<void>((r) => (release = r)))
  await assert.rejects(lock.run(['h::app'], 'an environment change', async () => {}), (e: any) => e instanceof ContainerBusyError && /an update/.test(e.message))
  // other containers are unaffected
  await lock.run(['h::other'], 'a recreate', async () => {})
  release()
  await first
  // and the container is free again afterwards, also after a failure
  await assert.rejects(lock.run(['h::app'], 'x', async () => { throw new Error('boom') }), /boom/)
  await lock.run(['h::app'], 'y', async () => {})
  assert.equal(lock.isBusy('h::app'), false)
})

test('the backup name is held too, so the renamed old container cannot be grabbed', async () => {
  const lock = createContainerLock()
  let release!: () => void
  const first = lock.run(['h::app', 'h::app-old-1'], 'an update', () => new Promise<void>((r) => (release = r)))
  await assert.rejects(lock.run(['h::app-old-1'], 'a recreate', async () => {}), ContainerBusyError)
  release()
  await first
})
