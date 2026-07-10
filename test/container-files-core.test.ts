import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normContainerPath,
  baseName,
  parentPath,
  resolveInRoot,
  withinRoot,
  listingFromTarEntries,
  parsePathStat,
} from '../server/utils/container-files-core.ts'

test('normContainerPath: collapses . and .., rejects escapes and bad input', () => {
  assert.equal(normContainerPath('/etc/searxng/'), '/etc/searxng')
  assert.equal(normContainerPath('/etc//searxng/./x'), '/etc/searxng/x')
  assert.equal(normContainerPath('/etc/searxng/../uwsgi.ini'), '/etc/uwsgi.ini')
  assert.equal(normContainerPath('/'), '/')
  assert.equal(normContainerPath('/..'), null) // escapes above root
  assert.equal(normContainerPath('relative/path'), null) // not absolute
  assert.equal(normContainerPath('/a\0b'), null) // null byte
  assert.equal(normContainerPath('/a\\b'), null) // backslash
})

test('baseName / parentPath', () => {
  assert.equal(baseName('/etc/searxng/settings.yml'), 'settings.yml')
  assert.equal(baseName('/etc/searxng/'), 'searxng')
  assert.equal(parentPath('/etc/searxng/settings.yml'), '/etc/searxng')
  assert.equal(parentPath('/config'), '/')
  assert.equal(parentPath('/'), '/')
})

test('resolveInRoot: joins relative paths and refuses to escape the root', () => {
  assert.equal(resolveInRoot('/etc/searxng', 'settings.yml'), '/etc/searxng/settings.yml')
  assert.equal(resolveInRoot('/etc/searxng', 'sub/x'), '/etc/searxng/sub/x')
  assert.equal(resolveInRoot('/etc/searxng', ''), '/etc/searxng')
  assert.equal(resolveInRoot('/etc/searxng', '../passwd'), null) // escape
  assert.equal(resolveInRoot('/etc/searxng', '/etc/passwd'), null) // absolute rel rejected
  assert.equal(resolveInRoot('/etc/searxng', 'a\0b'), null)
})

test('withinRoot: prefix containment is segment-aware', () => {
  assert.equal(withinRoot('/etc/searxng', '/etc/searxng/settings.yml'), true)
  assert.equal(withinRoot('/etc/searxng', '/etc/searxng'), true)
  assert.equal(withinRoot('/etc/searxng', '/etc/searxng-old/x'), false) // sibling prefix, not inside
  assert.equal(withinRoot('/etc/searxng', '/etc/passwd'), false)
})

test('listingFromTarEntries: one-level listing from a docker archive tar', () => {
  const entries = [
    { name: 'searxng/', type: 'directory', size: 0, mtimeMs: 1000 },
    { name: 'searxng/settings.yml', type: 'file', size: 512, mtimeMs: 2000 },
    { name: 'searxng/uwsgi.ini', type: 'file', size: 128, mtimeMs: 3000 },
    { name: 'searxng/sub/', type: 'directory', size: 0, mtimeMs: 4000 },
    { name: 'searxng/sub/deep.txt', type: 'file', size: 9, mtimeMs: 5000 }, // deeper — excluded
  ]
  const listing = listingFromTarEntries(entries, 'searxng')
  assert.deepEqual(
    listing.map((e) => [e.type, e.name, e.size]),
    [
      ['dir', 'sub', 0],
      ['file', 'settings.yml', 512],
      ['file', 'uwsgi.ini', 128],
    ],
  )
})

test('listingFromTarEntries: tolerates a ./ prefix and a dir seen only via its children', () => {
  const entries = [
    { name: './config/', type: 'directory', size: 0, mtimeMs: 1000 },
    { name: './config/app.conf', type: 'file', size: 42, mtimeMs: 2000 },
    { name: './config/logs/today.log', type: 'file', size: 7, mtimeMs: 2500 }, // implies a `logs` dir
  ]
  const listing = listingFromTarEntries(entries, 'config')
  assert.deepEqual(
    listing.map((e) => [e.type, e.name]),
    [
      ['dir', 'logs'],
      ['file', 'app.conf'],
    ],
  )
})

test('parsePathStat: decodes base64 JSON and reads the directory/symlink mode bits', () => {
  const dir = Buffer.from(JSON.stringify({ name: 'searxng', size: 4096, mode: 0x800001ed })).toString('base64')
  const s = parsePathStat(dir)
  assert.equal(s?.name, 'searxng')
  assert.equal(s?.isDir, true)
  assert.equal(s?.isSymlink, false)

  const file = Buffer.from(JSON.stringify({ name: 'settings.yml', size: 512, mode: 0x1a4 })).toString('base64')
  const f = parsePathStat(file)
  assert.equal(f?.isDir, false)
  assert.equal(f?.size, 512)

  assert.equal(parsePathStat(null), null)
  assert.equal(parsePathStat('not-base64-json!!!'), null)
})
