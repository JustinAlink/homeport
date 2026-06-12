import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseImageRef, digestMatches, pickDueChecks } from '../server/utils/registry-core.ts'
import { buildCreatePayload } from '../server/utils/recreate-core.ts'

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')

// ---- parseImageRef ----

test('parseImageRef: Hub shorthand → library/, latest tag', () => {
  assert.deepEqual(parseImageRef('nginx'), { registry: 'docker.io', repo: 'library/nginx', tag: 'latest', digestPinned: false })
})

test('parseImageRef: user repos, tags, registries, ports, digests', () => {
  assert.deepEqual(parseImageRef('user/app:1.2'), { registry: 'docker.io', repo: 'user/app', tag: '1.2', digestPinned: false })
  assert.deepEqual(parseImageRef('ghcr.io/owner/app'), { registry: 'ghcr.io', repo: 'owner/app', tag: 'latest', digestPinned: false })
  assert.deepEqual(parseImageRef('registry.example.com:5000/team/app:v3'), {
    registry: 'registry.example.com:5000',
    repo: 'team/app',
    tag: 'v3',
    digestPinned: false,
  })
  assert.equal(parseImageRef('nginx@sha256:abc123').digestPinned, true)
  assert.deepEqual(parseImageRef('lscr.io/linuxserver/sonarr:4.0.9').repo, 'linuxserver/sonarr')
})

// ---- digestMatches ----

test('digestMatches', () => {
  const local = ['nginx@sha256:aaa', 'docker.io/library/nginx@sha256:bbb']
  assert.equal(digestMatches(local, 'sha256:bbb'), true)
  assert.equal(digestMatches(local, 'sha256:ccc'), false)
  assert.equal(digestMatches([], 'sha256:aaa'), false)
  assert.equal(digestMatches(undefined, 'sha256:aaa'), false)
})

// ---- pickDueChecks ----

test('pickDueChecks: unchecked first, interval respected, batch capped', () => {
  const hour = 3600_000
  const now = 100 * hour
  const cache = {
    a: { status: 'current' as const, checkedAt: now - 2 * hour },
    b: { status: 'current' as const, checkedAt: now - 30 * 60_000 }, // fresh
    c: undefined, // never checked
  }
  const due = pickDueChecks(['a', 'b', 'c'], cache, now, hour, 10)
  assert.deepEqual(due, ['c', 'a']) // c (never) first, b skipped
  assert.deepEqual(pickDueChecks(['a', 'c'], cache, now, hour, 1), ['c']) // batch cap
})

// ---- buildCreatePayload (fixture) ----

test('recreate: payload preserves config, drops short-id hostname/alias, splits networks', () => {
  const inspect = JSON.parse(readFileSync(join(dir, 'inspect-container.json'), 'utf8'))
  const plan = buildCreatePayload(inspect, 'user/webapp:1.2')

  assert.equal(plan.name, 'webapp')
  assert.equal(plan.config.Image, 'user/webapp:1.2')
  assert.equal(plan.config.Hostname, undefined) // short-id hostname dropped
  assert.deepEqual(plan.config.Env, ['TZ=Europe/Amsterdam', 'NODE_ENV=production'])
  assert.deepEqual(plan.config.HostConfig.Binds, ['/srv/webapp/data:/data:rw']) // mounts preserved
  assert.equal(plan.config.HostConfig.RestartPolicy.Name, 'unless-stopped')
  assert.equal(plan.config.HostConfig.Memory, 536870912)

  // first network in the create payload, alias minus the short id
  const eps = plan.config.NetworkingConfig.EndpointsConfig
  assert.deepEqual(Object.keys(eps), ['web_default'])
  assert.deepEqual(eps.web_default.Aliases, ['webapp'])

  // second network returned for post-create connect, IPAM preserved
  assert.deepEqual(Object.keys(plan.extraNetworks), ['npm-network'])
  assert.equal(plan.extraNetworks['npm-network'].IPAMConfig.IPv4Address, '172.20.0.10')
})

test('recreate: keeps a custom (non short-id) hostname', () => {
  const inspect = JSON.parse(readFileSync(join(dir, 'inspect-container.json'), 'utf8'))
  inspect.Config.Hostname = 'my-pinned-host'
  const plan = buildCreatePayload(inspect, 'user/webapp:1.2')
  assert.equal(plan.config.Hostname, 'my-pinned-host')
})
