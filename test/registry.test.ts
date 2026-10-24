import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseImageRef, digestMatches, pickDueChecks, isBareImageId, normalizeRegistry, authForImage, dockerConfigJson, mergeRegistryCredSecrets, changelogUrlFor, hasExplicitTag, pullInterruptedByPrune } from '../server/utils/registry-core.ts'
import { buildCreatePayload } from '../server/utils/recreate-core.ts'

// ---- mergeRegistryCredSecrets (masked-token keep-existing on save) ----

test('mergeRegistryCredSecrets: blank token reuses the stored one (no wipe)', () => {
  const existing = [{ registry: 'ghcr.io', username: 'me', token: 'ghp_real' }]
  const incoming = [{ registry: 'ghcr.io', username: 'me', token: '' }] // masked on read
  const out = mergeRegistryCredSecrets(incoming, existing)
  assert.deepEqual(out, [{ registry: 'ghcr.io', username: 'me', token: 'ghp_real' }])
})

test('mergeRegistryCredSecrets: a freshly typed token overrides the stored one', () => {
  const existing = [{ registry: 'ghcr.io', username: 'me', token: 'old' }]
  const incoming = [{ registry: 'ghcr.io', username: 'me', token: 'new' }]
  assert.equal(mergeRegistryCredSecrets(incoming, existing)[0].token, 'new')
})

test('mergeRegistryCredSecrets: a blank token with no stored match is dropped', () => {
  const out = mergeRegistryCredSecrets(
    [{ registry: 'ghcr.io', username: 'me', token: '' }],
    [{ registry: 'docker.io', username: 'x', token: 't' }],
  )
  assert.deepEqual(out, []) // an empty row = "remove this login"
})

test('mergeRegistryCredSecrets: matches by normalized registry across docker.io aliases', () => {
  const existing = [{ registry: 'docker.io', username: 'u', token: 'dtok' }]
  const incoming = [{ registry: 'index.docker.io', username: 'u', token: '' }]
  assert.equal(mergeRegistryCredSecrets(incoming, existing)[0]?.token, 'dtok')
})

test('mergeRegistryCredSecrets: keeps new + existing together', () => {
  const existing = [{ registry: 'ghcr.io', username: 'me', token: 'keep' }]
  const incoming = [
    { registry: 'ghcr.io', username: 'me', token: '' }, // keep existing
    { registry: 'docker.io', username: 'you', token: 'brand-new' }, // add
  ]
  const out = mergeRegistryCredSecrets(incoming, existing)
  assert.equal(out.length, 2)
  assert.equal(out.find((c) => c.registry === 'ghcr.io')?.token, 'keep')
  assert.equal(out.find((c) => c.registry === 'docker.io')?.token, 'brand-new')
})

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

// ---- changelogUrlFor ----

test('changelogUrlFor: ghcr.io owner/repo → GitHub releases', () => {
  assert.equal(changelogUrlFor('ghcr.io/owner/repo'), 'https://github.com/owner/repo/releases')
  assert.equal(changelogUrlFor('ghcr.io/owner/repo:1.2.3'), 'https://github.com/owner/repo/releases')
})

test('changelogUrlFor: ghcr.io subpath packages → undefined', () => {
  assert.equal(changelogUrlFor('ghcr.io/owner/repo/subimage'), undefined)
})

test('changelogUrlFor: docker.io two-segment non-library → best-effort GitHub releases', () => {
  assert.equal(changelogUrlFor('someuser/someapp'), 'https://github.com/someuser/someapp/releases')
  assert.equal(changelogUrlFor('someuser/someapp:latest'), 'https://github.com/someuser/someapp/releases')
})

test('changelogUrlFor: docker.io official single-segment images → undefined', () => {
  assert.equal(changelogUrlFor('nginx'), undefined)
  assert.equal(changelogUrlFor('postgres'), undefined)
  assert.equal(changelogUrlFor('library/redis'), undefined)
})

test('changelogUrlFor: other registries → undefined (no reliable inference)', () => {
  assert.equal(changelogUrlFor('quay.io/x/y'), undefined)
  assert.equal(changelogUrlFor('lscr.io/linuxserver/sonarr'), undefined)
  assert.equal(changelogUrlFor('myregistry.example.com:5000/x/y'), undefined)
})

// ---- isBareImageId ----

test('isBareImageId: bare digests are unqueryable, refs are not', () => {
  const sha = 'bd42573ed96e5671a1c279d97c29874aff5793bb66e38c8a9b98f827ac1ab526'
  assert.equal(isBareImageId(`sha256:${sha}`), true)
  assert.equal(isBareImageId(sha), true)
  assert.equal(isBareImageId('ghcr.io/justinalink/junipergray-web:latest'), false)
  assert.equal(isBareImageId('nginx'), false)
  assert.equal(isBareImageId('user/app@sha256:' + sha), false) // digest-pinned ref, not a bare id
})

// ---- registry auth ----

test('normalizeRegistry: docker.io aliases collapse, hosts pass through', () => {
  assert.equal(normalizeRegistry('docker.io'), 'docker.io')
  assert.equal(normalizeRegistry('index.docker.io'), 'docker.io')
  assert.equal(normalizeRegistry('registry-1.docker.io'), 'docker.io')
  assert.equal(normalizeRegistry(''), 'docker.io')
  assert.equal(normalizeRegistry('https://ghcr.io/'), 'ghcr.io')
  assert.equal(normalizeRegistry('GHCR.IO'), 'ghcr.io')
  assert.equal(normalizeRegistry('registry.example.com:5000'), 'registry.example.com:5000')
})

test('authForImage: matches by registry, maps docker.io serveraddress, else undefined', () => {
  const creds = [
    { registry: 'ghcr.io', username: 'justinalink', token: 'ghp_abc' },
    { registry: 'docker.io', username: 'me', token: 'dckr_xyz' },
  ]
  assert.deepEqual(authForImage('ghcr.io/justinalink/junipergray-web:latest', creds), {
    username: 'justinalink',
    password: 'ghp_abc',
    serveraddress: 'ghcr.io',
  })
  assert.equal(authForImage('nginx', creds)?.serveraddress, 'https://index.docker.io/v1/')
  assert.equal(authForImage('ghcr.io/other/app', []), undefined) // no creds
  assert.equal(authForImage('lscr.io/linuxserver/sonarr', creds), undefined) // no match
})

// ---- dockerConfigJson (compose CLI auth) ----

test('dockerConfigJson: one auths entry per cred, docker.io keyed by the v1 URL', () => {
  const out = JSON.parse(
    dockerConfigJson([
      { registry: 'https://ghcr.io/', username: 'justinalink', token: 'ghp_abc' },
      { registry: 'index.docker.io', username: 'me', token: 'dckr_xyz' },
    ])!,
  )
  assert.deepEqual(Object.keys(out.auths), ['ghcr.io', 'https://index.docker.io/v1/'])
  assert.equal(Buffer.from(out.auths['ghcr.io'].auth, 'base64').toString(), 'justinalink:ghp_abc')
})

test('dockerConfigJson: nothing to write → undefined (no DOCKER_CONFIG override)', () => {
  assert.equal(dockerConfigJson(undefined), undefined)
  assert.equal(dockerConfigJson([]), undefined)
  assert.equal(dockerConfigJson([{ registry: 'ghcr.io', username: 'me', token: '' }]), undefined)
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

test('hasExplicitTag: a digest pin may or may not name its tag', () => {
  assert.equal(hasExplicitTag('jc21/nginx-proxy-manager:2.16.0@sha256:abc'), true)
  assert.equal(hasExplicitTag('nginx@sha256:abc'), false)
  assert.equal(hasExplicitTag('registry:5000/app@sha256:abc'), false) // a port is not a tag
  assert.equal(hasExplicitTag('registry:5000/app:1.2'), true)
})

test('pullInterruptedByPrune: recognises the containerd lease error, nothing else', () => {
  assert.equal(pullInterruptedByPrune('failed to commit: lease "abc123": lease does not exist: not found'), true)
  assert.equal(pullInterruptedByPrune('Error response from daemon: lease does not exist: not found'), true)
  assert.equal(pullInterruptedByPrune('manifest unknown'), false)
  assert.equal(pullInterruptedByPrune('pull access denied for x, repository does not exist'), false)
  assert.equal(pullInterruptedByPrune('release v9 does not exist'), false) // "release" contains "lease"
})
