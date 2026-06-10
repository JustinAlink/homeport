import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guard } from '../server/utils/guard.ts'

const defer = () => {
  let resolve!: (v?: unknown) => void
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

test('guard: second concurrent call is skipped (returns null)', async () => {
  const d = defer()
  let calls = 0
  const g = guard(async () => {
    calls++
    await d.promise
    return 'done'
  })

  const first = g() // starts running
  const second = await g() // in-flight → skipped
  assert.equal(second, null)
  assert.equal(calls, 1)

  d.resolve()
  assert.equal(await first, 'done')
})

test('guard: runs again after the previous call settles', async () => {
  let calls = 0
  const g = guard(async () => {
    calls++
    return calls
  })

  assert.equal(await g(), 1)
  assert.equal(await g(), 2)
})

test('guard: releases the lock even when fn throws', async () => {
  let calls = 0
  const g = guard(async () => {
    calls++
    throw new Error('boom')
  })

  await assert.rejects(g(), /boom/)
  // lock released → next call runs
  await assert.rejects(g(), /boom/)
  assert.equal(calls, 2)
})
