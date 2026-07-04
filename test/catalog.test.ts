import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYAML } from 'confbox/yaml'
import {
  parsePortainerTemplates,
  parseNativeCatalog,
  parseCatalogDocument,
  mergeApps,
  resolveInputs,
  substituteTokens,
  composeForInstall,
  slugify,
} from '../server/utils/catalog-core.ts'
import { BUILTIN_CATALOG } from '../server/utils/catalog-builtin.ts'

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const portainerDoc = JSON.parse(readFileSync(join(dir, 'portainer-templates.json'), 'utf8'))

test('slugify: lowercases, strips, bounds', () => {
  assert.equal(slugify('Uptime Kuma!'), 'uptime-kuma')
  assert.equal(slugify('  --Wéird__name--  '), 'w-ird-name')
  assert.equal(slugify(''), '')
})

test('portainer: parses type-1 linux, skips git-stack and windows', () => {
  const { apps, skipped } = parsePortainerTemplates(portainerDoc, 'https://src')
  assert.equal(apps.length, 1)
  assert.equal(skipped, 2)
  const app = apps[0]
  assert.equal(app.slug, 'whoami')
  assert.equal(app.image, 'traefik/whoami:latest')
  assert.equal(app.icon, 'https://example.com/whoami.png')
  assert.equal(app.notes, 'Demo container.')
  assert.equal(app.inputs.length, 3)
  assert.equal(app.inputs[1].select?.length, 2)
  assert.equal(app.inputs[1].default, 'info') // from select default:true
  assert.equal(app.inputs[2].preset, true)
})

test('portainer: generated compose is valid YAML with the right shape', () => {
  const { apps } = parsePortainerTemplates(portainerDoc, 'src')
  const doc: any = parseYAML(apps[0].compose)
  const svc = doc.services.whoami
  assert.equal(svc.image, 'traefik/whoami:latest')
  assert.deepEqual(svc.ports, ['8000:80/tcp'])
  assert.equal(svc.restart, 'always')
  // anonymous volume became a named one; bind mount preserved with :ro
  assert.deepEqual(svc.volumes, ['whoami-data:/data', '/etc/localtime:/etc/localtime:ro'])
  assert.ok('whoami-data' in doc.volumes)
  // env prompts became {{TOKENS}}; logo + custom labels carried over
  assert.equal(svc.environment.WHOAMI_NAME, '{{WHOAMI_NAME}}')
  assert.equal(svc.labels['hub.icon'], 'https://example.com/whoami.png')
  assert.equal(svc.labels['my.custom'], 'yes')
})

test('native: built-in catalog parses fully, slugs unique', () => {
  const { apps, skipped } = parseNativeCatalog(BUILTIN_CATALOG, 'built-in')
  assert.equal(skipped, 0)
  assert.ok(apps.length >= 10)
  assert.equal(new Set(apps.map((a) => a.slug)).size, apps.length)
  for (const app of apps) {
    assert.ok(app.compose.includes('services:'), `${app.slug} has compose`)
    // every {{TOKEN}} in the compose is declared as an input
    const tokens = [...app.compose.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map((m) => m[1])
    for (const t of tokens) {
      assert.ok(app.inputs.some((i) => i.name === t), `${app.slug}: input ${t} declared`)
    }
  }
})

test('document auto-detect: native vs portainer', () => {
  assert.equal(parseCatalogDocument(BUILTIN_CATALOG, 's').format, 'native')
  assert.equal(parseCatalogDocument(portainerDoc, 's').format, 'portainer')
})

test('mergeApps: first source wins on slug collision', () => {
  const a = parseNativeCatalog(BUILTIN_CATALOG, 'built-in').apps
  const clash = [{ ...a[0], description: 'imposter', source: 'remote' }]
  const merged = mergeApps([a, clash])
  assert.equal(merged.length, a.length)
  assert.notEqual(merged.find((x) => x.slug === a[0].slug)?.description, 'imposter')
})

test('resolveInputs: defaults, required, select, preset, control chars', () => {
  const { apps } = parsePortainerTemplates(portainerDoc, 'src')
  const app = { ...apps[0] }
  app.inputs = [
    ...app.inputs,
    { name: 'NEEDED', label: 'Needed', required: true },
  ]
  let r = resolveInputs(app, {})
  assert.equal(r.ok, false)
  assert.match(r.errors.join(), /Needed is required/)

  r = resolveInputs(app, { NEEDED: 'x', LOG_LEVEL: 'nope' })
  assert.equal(r.ok, false)
  assert.match(r.errors.join(), /must be one of info, debug/)

  r = resolveInputs(app, { NEEDED: 'x', HIDDEN_PRESET: 'override-attempt' })
  assert.equal(r.ok, true)
  assert.equal(r.values.WHOAMI_NAME, 'whoami-1') // default applied
  assert.equal(r.values.LOG_LEVEL, 'info') // select default applied
  assert.equal(r.values.HIDDEN_PRESET, 'fixed') // preset ignores the given value

  r = resolveInputs(app, { NEEDED: 'bad\nvalue' })
  assert.equal(r.ok, false)
  assert.match(r.errors.join(), /control characters/)
})

test('substituteTokens: replaces known, reports unknown', () => {
  const { content, unresolved } = substituteTokens('port: "{{PORT}}" x: {{NOPE}}', { PORT: '8080' })
  assert.equal(content, 'port: "8080" x: {{NOPE}}')
  assert.deepEqual(unresolved, ['NOPE'])
})

test('composeForInstall: end-to-end on a built-in app', () => {
  const { apps } = parseNativeCatalog(BUILTIN_CATALOG, 'built-in')
  const kuma = apps.find((a) => a.slug === 'uptime-kuma')!
  const bad = composeForInstall(kuma, { PORT: '' })
  assert.equal(bad.ok, true) // PORT has a default → fine even when empty

  const out = composeForInstall(kuma, { PORT: '3200' })
  assert.ok(out.ok)
  const doc: any = parseYAML((out as any).content)
  assert.deepEqual(doc.services['uptime-kuma'].ports, ['3200:3001'])
})
