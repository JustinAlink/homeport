import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSecretEnvKey, parseEnv, mergeEnv } from '../server/utils/env-core.ts'
import { buildCreatePayload, stripImageDefaults } from '../server/utils/recreate-core.ts'

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

test('stripImageDefaults: a newer image brings its own ENV, CMD and labels; user values survive', () => {
  const oldImage = {
    Env: ['PATH=/usr/lib/postgresql/16/bin:/usr/bin', 'PG_MAJOR=16'],
    Cmd: ['postgres'],
    Labels: { 'org.opencontainers.image.version': '16.4' },
    ExposedPorts: { '5432/tcp': {} },
    WorkingDir: '',
  }
  const containerConfig = {
    Env: ['PATH=/usr/lib/postgresql/16/bin:/usr/bin', 'PG_MAJOR=16', 'POSTGRES_PASSWORD=x'],
    Cmd: ['postgres'],
    Labels: { 'org.opencontainers.image.version': '16.4', 'com.example.mine': 'yes' },
    ExposedPorts: { '5432/tcp': {}, '9187/tcp': {} },
    WorkingDir: '',
    Hostname: 'db',
  }
  const out = stripImageDefaults(containerConfig, oldImage)
  assert.deepEqual(out.Env, ['POSTGRES_PASSWORD=x'])
  assert.equal('Cmd' in out, false)
  assert.equal('WorkingDir' in out, false)
  assert.deepEqual(out.Labels, { 'com.example.mine': 'yes' })
  assert.deepEqual(out.ExposedPorts, { '9187/tcp': {} })
  assert.equal(out.Hostname, 'db')
  // a command the user overrode is theirs to keep
  assert.deepEqual(stripImageDefaults({ Cmd: ['postgres', '-c', 'max_connections=200'] }, oldImage).Cmd, ['postgres', '-c', 'max_connections=200'])
  // and the original input is not mutated
  assert.equal(containerConfig.Env.length, 3)
})

test('buildCreatePayload: with the old image config, the new image is not handed stale defaults', () => {
  const inspect = { Name: '/db', Id: 'abc', Config: { Image: 'postgres:16', Env: ['PG_MAJOR=16', 'A=1'] }, HostConfig: {}, NetworkSettings: { Networks: {} } }
  const plan = buildCreatePayload(inspect, 'postgres:17', { oldImageConfig: { Env: ['PG_MAJOR=16'] } })
  assert.deepEqual(plan.config.Env, ['A=1'])
  assert.equal(plan.config.Image, 'postgres:17')
})
