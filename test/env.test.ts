import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSecretEnvKey, parseEnv, mergeEnv } from '../server/utils/env-core.ts'
import { buildCreatePayload } from '../server/utils/recreate-core.ts'

test('isSecretEnvKey: masks the usual suspects, leaves plain config alone', () => {
  for (const k of ['DB_PASSWORD', 'MYSQL_ROOT_PASSWD', 'JWT_SECRET', 'API_TOKEN', 'APIKEY', 'SSH_PRIVATE_KEY', 'APP_KEY', 'KEY']) {
    assert.equal(isSecretEnvKey(k), true, k)
  }
  for (const k of ['TZ', 'PUID', 'KEYBOARD_LAYOUT', 'PORT', 'LOG_LEVEL']) {
    assert.equal(isSecretEnvKey(k), false, k)
  }
})

test('parseEnv: splits on the first =, withholds secret values', () => {
  const rows = parseEnv(['TZ=Europe/Amsterdam', 'OPTS=a=b=c', 'DB_PASSWORD=hunter2', 'FLAG'])
  assert.deepEqual(rows[0], { key: 'TZ', value: 'Europe/Amsterdam', secret: false })
  assert.equal(rows[1].value, 'a=b=c')
  assert.deepEqual(rows[2], { key: 'DB_PASSWORD', value: null, secret: true })
  assert.deepEqual(rows[3], { key: 'FLAG', value: '', secret: false })
})

test('mergeEnv: null keeps the existing (secret) value', () => {
  const out = mergeEnv(['DB_PASSWORD=hunter2', 'TZ=UTC'], [
    { key: 'DB_PASSWORD', value: null },
    { key: 'TZ', value: 'Europe/Amsterdam' },
  ])
  assert.deepEqual(out, ['DB_PASSWORD=hunter2', 'TZ=Europe/Amsterdam'])
})

test('mergeEnv: omitted keys are deleted, new keys are added', () => {
  const out = mergeEnv(['OLD=1', 'KEEP=x'], [
    { key: 'KEEP', value: 'x' },
    { key: 'NEW', value: 'y' },
  ])
  assert.deepEqual(out, ['KEEP=x', 'NEW=y'])
})

test('mergeEnv: rejects bad names, duplicates, and keep-without-existing', () => {
  assert.throws(() => mergeEnv([], [{ key: 'BAD NAME', value: '1' }]), /invalid variable/)
  assert.throws(() => mergeEnv([], [{ key: 'A=B', value: '1' }]), /invalid variable/)
  assert.throws(() => mergeEnv([], [{ key: 'A', value: '1' }, { key: 'A', value: '2' }]), /duplicate/)
  assert.throws(() => mergeEnv([], [{ key: 'GONE', value: null }]), /no existing value/)
})

test('buildCreatePayload: env override replaces Config.Env', () => {
  const inspect = {
    Id: 'abcdef123456',
    Name: '/web',
    Config: { Image: 'nginx:alpine', Env: ['OLD=1'] },
    HostConfig: {},
    NetworkSettings: { Networks: {} },
  }
  const plan = buildCreatePayload(inspect, 'nginx:alpine', { env: ['NEW=2'] })
  assert.deepEqual(plan.config.Env, ['NEW=2'])
  const untouched = buildCreatePayload(inspect, 'nginx:alpine')
  assert.deepEqual(untouched.config.Env, ['OLD=1'])
})
