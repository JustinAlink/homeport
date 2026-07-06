import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseYAML } from 'confbox/yaml'
import {
  parseHubCount,
  serviceNameFromImage,
  imageMetaFromConfig,
  pickManifestDigest,
  composeFromImage,
  dockerfilePorts,
  composeForBuild,
} from '../server/utils/autostack-core.ts'

test('parseHubCount: suffixed strings and numbers', () => {
  assert.equal(parseHubCount('1B+'), 1e9)
  assert.equal(parseHubCount('500M+'), 5e8)
  assert.equal(parseHubCount('10K+'), 10_000)
  assert.equal(parseHubCount('1.5M'), 1_500_000)
  assert.equal(parseHubCount('1234'), 1234)
  assert.equal(parseHubCount(42), 42)
  assert.equal(parseHubCount('garbage'), 0)
  assert.equal(parseHubCount(undefined), 0)
})

test('serviceNameFromImage: last segment, tag/digest stripped, sanitized', () => {
  assert.equal(serviceNameFromImage('nginx'), 'nginx')
  assert.equal(serviceNameFromImage('linuxserver/jellyfin:latest'), 'jellyfin')
  assert.equal(serviceNameFromImage('ghcr.io/owner/My.App@sha256:abc'), 'my-app')
  assert.equal(serviceNameFromImage(''), 'app')
})

test('imageMetaFromConfig: tcp ports sorted+deduped, udp dropped, volumes kept', () => {
  const meta = imageMetaFromConfig({
    config: {
      ExposedPorts: { '8096/tcp': {}, '1900/udp': {}, '8096/tcp ': {}, '443/tcp': {} },
      Volumes: { '/config': {}, '/media': {} },
    },
  })
  assert.deepEqual(meta.ports, [443, 8096])
  assert.deepEqual(meta.volumes, ['/config', '/media'])
  assert.deepEqual(imageMetaFromConfig({}), { ports: [], volumes: [] })
  assert.deepEqual(imageMetaFromConfig(null), { ports: [], volumes: [] })
})

test('pickManifestDigest: prefers linux/amd64, skips attestation entries', () => {
  const digest = pickManifestDigest({
    manifests: [
      { digest: 'sha256:att', platform: { os: 'unknown', architecture: 'unknown' } },
      { digest: 'sha256:arm', platform: { os: 'linux', architecture: 'arm64' } },
      { digest: 'sha256:amd', platform: { os: 'linux', architecture: 'amd64' } },
    ],
  })
  assert.equal(digest, 'sha256:amd')
  // no amd64 → first linux
  assert.equal(
    pickManifestDigest({ manifests: [{ digest: 'sha256:arm', platform: { os: 'linux', architecture: 'arm64' } }] }),
    'sha256:arm',
  )
  assert.equal(pickManifestDigest({}), null)
  assert.equal(pickManifestDigest({ manifests: [] }), null)
})

test('composeFromImage: ports + named volumes, invalid entries dropped', () => {
  const yaml = composeFromImage('linuxserver/jellyfin:latest', {
    ports: [
      { container: 8096, host: 8096 },
      { container: 0, host: 99 }, // invalid → dropped
    ],
    volumes: ['/config', 'relative/nope', '/has space'],
  })
  const doc: any = parseYAML(yaml)
  const svc = doc.services.jellyfin
  assert.equal(svc.image, 'linuxserver/jellyfin:latest')
  assert.equal(svc.restart, 'unless-stopped')
  assert.deepEqual(svc.ports, ['8096:8096'])
  assert.deepEqual(svc.volumes, ['jellyfin-config:/config'])
  assert.ok('jellyfin-config' in doc.volumes)
})

test('composeFromImage: no ports/volumes → minimal service', () => {
  const doc: any = parseYAML(composeFromImage('redis', { ports: [], volumes: [] }))
  assert.deepEqual(Object.keys(doc.services.redis).sort(), ['image', 'restart'])
  assert.equal(doc.volumes, undefined)
})

test('dockerfilePorts: EXPOSE parsing', () => {
  const ports = dockerfilePorts(
    [
      'FROM node:20-alpine',
      'EXPOSE 3000',
      'expose 8080/tcp 9000/udp # dev port',
      '  EXPOSE 3000', // duplicate
      '# EXPOSE 5000 (commented out)',
      'EXPOSE ${PORT}',
    ].join('\n'),
  )
  assert.deepEqual(ports, [3000, 8080])
  assert.deepEqual(dockerfilePorts('FROM scratch'), [])
})

test('composeForBuild: build-in-place with 1:1 ports', () => {
  const doc: any = parseYAML(composeForBuild('my-app', [3000]))
  assert.equal(doc.services['my-app'].build, '.')
  assert.deepEqual(doc.services['my-app'].ports, ['3000:3000'])
  const bare: any = parseYAML(composeForBuild('tool', []))
  assert.equal(bare.services.tool.ports, undefined)
})
