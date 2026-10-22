import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findNewer, tagKindOf, parseWwwAuthenticate, nextPageUrl, withTag } from '../server/utils/versions-core.ts'

test('a pinned release finds the newest tag of the same shape, never a pre-release or another flavour', () => {
  const tags = ['10.9.6', '10.9.11', '10.10.0', '10.10.3', '10.11.0-rc1', '10.10.3-alpine', 'latest', '10', '10.10']
  assert.deepEqual(findNewer('10.9.6', tags), { newer: { tag: '10.10.3', bump: 'minor' } })
  assert.deepEqual(findNewer('10.10.3', tags), {})
  assert.deepEqual(findNewer('10.9.11', ['10.9.12', '10.9.6']), { newer: { tag: '10.9.12', bump: 'patch' } })
})

test('a major jump also offers the newest release on the current major', () => {
  const tags = ['16.4', '16.10', '17.0', '17.6', '18.1', '16.10-alpine']
  assert.deepEqual(findNewer('16.4', tags), { newer: { tag: '18.1', bump: 'major' }, newerSameMajor: { tag: '16.10', bump: 'minor' } })
  // a one-number line can only move to the next major
  assert.deepEqual(findNewer('16-alpine', ['16-alpine', '17-alpine', '18-alpine', '18', '18-bookworm']), { newer: { tag: '18-alpine', bump: 'major' } })
})

test('prefix and versioned suffixes keep their shape; date stamps are not a newer major', () => {
  assert.deepEqual(findNewer('v3.39.0', ['v3.40.1', '3.41.0', 'v3.39.1']), { newer: { tag: 'v3.40.1', bump: 'minor' } })
  assert.deepEqual(findNewer('1.2-alpine3.19', ['1.3-alpine3.20', '1.3-alpine']), { newer: { tag: '1.3-alpine3.20', bump: 'minor' } })
  assert.deepEqual(findNewer('16', ['17', '20240101', '160']), { newer: { tag: '160', bump: 'major' } })
  assert.deepEqual(findNewer('16', ['20240101']), {})
})

test('calendar versions: a new year is not a major release', () => {
  assert.deepEqual(findNewer('2024.10.1', ['2024.12.5', '2026.10.2', '2024.10.3']), { newer: { tag: '2026.10.2', bump: 'minor' } })
  assert.deepEqual(findNewer('2024.10.1', ['2024.10.3']), { newer: { tag: '2024.10.3', bump: 'patch' } })
})

test('floating tags have no version to compare', () => {
  assert.deepEqual(findNewer('latest', ['1.0', '2.0']), {})
  assert.equal(tagKindOf('latest'), 'floating')
  assert.equal(tagKindOf('stable-alpine'), 'floating')
})

test('tag kind: lines are detected from longer tags, precision is only a fallback', () => {
  assert.equal(tagKindOf('1.25', ['1.25', '1.25.4', '1.26.0']), 'line')
  assert.equal(tagKindOf('16.4', ['16.4', '16.5', '17.0']), 'exact')
  assert.equal(tagKindOf('5-alpine', ['5-alpine', '5.96.0-alpine']), 'line')
  assert.equal(tagKindOf('1.32.0'), 'exact')
  assert.equal(tagKindOf('16'), 'line')
  assert.equal(tagKindOf('16.4'), undefined)
})

test('registry auth challenge and pagination headers', () => {
  assert.deepEqual(parseWwwAuthenticate('Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:a/b:pull"'), {
    scheme: 'bearer',
    params: { realm: 'https://ghcr.io/token', service: 'ghcr.io', scope: 'repository:a/b:pull' },
  })
  assert.equal(parseWwwAuthenticate(undefined), null)
  assert.equal(
    nextPageUrl('</v2/library/postgres/tags/list?last=16&n=1000>; rel="next"', 'https://registry-1.docker.io/v2/library/postgres/tags/list?n=1000'),
    'https://registry-1.docker.io/v2/library/postgres/tags/list?last=16&n=1000',
  )
  assert.equal(nextPageUrl(null, 'https://x'), undefined)
})

test('swapping a tag keeps the registry (and its port) as written', () => {
  assert.equal(withTag('jellyfin/jellyfin:10.9.6', '10.10.3'), 'jellyfin/jellyfin:10.10.3')
  assert.equal(withTag('registry:5000/app', '2.0'), 'registry:5000/app:2.0')
  assert.equal(withTag('ghcr.io/o/app:1.0@sha256:abc', '1.1'), 'ghcr.io/o/app:1.1')
})
