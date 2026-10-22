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
  normalizeCategory,
  plainDescription,
  imageKey,
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

test('built-in: Nginx Proxy Manager reverse-proxy template installs correctly', () => {
  const { apps } = parseNativeCatalog(BUILTIN_CATALOG, 'built-in')
  const npm = apps.find((a) => a.slug === 'nginx-proxy-manager')
  assert.ok(npm, 'NPM template is present')
  assert.deepEqual(npm!.categories, ['Reverse Proxy']) // normalizeCategory title-cases it
  assert.equal(npm!.image, 'jc21/nginx-proxy-manager:latest')

  const out = composeForInstall(npm!, { ADMIN_PORT: '8181' })
  assert.ok(out.ok, 'compose generates')
  const doc: any = parseYAML((out as any).content)
  const svc = doc.services['nginx-proxy-manager']
  // reverse proxy owns 80/443 on the host + the chosen admin port
  assert.ok(svc.ports.includes('80:80') && svc.ports.includes('443:443'))
  assert.ok(svc.ports.includes('8181:81'))
  // must join the shared external network so homeport (and other apps) can reach it by name
  assert.deepEqual(svc.networks, ['npm-network'])
  assert.equal(doc.networks['npm-network'].external, true)
})

test('normalizeCategory: merges community list inconsistencies', () => {
  assert.equal(normalizeCategory('development'), 'Development')
  assert.equal(normalizeCategory('Development'), 'Development')
  assert.equal(normalizeCategory('continuous-integration'), 'Continuous Integration')
  assert.equal(normalizeCategory('CMS'), 'CMS')
  assert.equal(normalizeCategory('operating_system'), 'Operating System')
})

test('categories: comma-joined community strings split into separate categories', () => {
  const doc = { templates: [{ type: 1, title: 'X', image: 'x:1', platform: 'linux', categories: ['Network,Other', 'network'] }] }
  const { apps } = parsePortainerTemplates(doc, 's')
  assert.deepEqual(apps[0].categories, ['Network', 'Other'])
})

test('categories: camelCase splits and known-broken aliases', () => {
  assert.equal(normalizeCategory('WebServer'), 'Web Server')
  assert.equal(normalizeCategory('Networkother'), 'Network') // unsplittable mash → alias
  assert.equal(normalizeCategory('Networking'), 'Network')
})

test('plainDescription: markdown links keep their text, images/tags/emphasis go', () => {
  assert.equal(
    plainDescription('[Airsonic-advanced](https://github.com/kagemomiji/airsonic-advanced) is a **free** media streamer'),
    'Airsonic-advanced is a free media streamer',
  )
  assert.equal(plainDescription('![logo](https://x/y.png) <b>Fast</b> `cli`\n\n# Notes'), 'Fast cli Notes')
  // ordinary text (incl. single underscores in names) is left alone
  assert.equal(plainDescription('Runs my_app on port 80'), 'Runs my_app on port 80')
  assert.equal(plainDescription(undefined), '')
})

test('parsePortainerTemplates: descriptions come out as plain text', () => {
  const { apps } = parsePortainerTemplates(
    { version: '2', templates: [{ type: 1, title: 'Demo', image: 'demo/app:1', description: '[Demo](https://demo.example) does things' }] },
    'test',
  )
  assert.equal(apps[0]?.description, 'Demo does things')
})

test('mergeApps: one entry per image across sources, the earlier source wins', () => {
  const app = (slug: string, name: string, image: string, source: string) =>
    ({ slug, name, description: '', categories: [], icon: '', image, source, compose: '', inputs: [] }) as any
  const merged = mergeApps([
    [app('adguard-home', 'AdGuard Home', 'adguard/adguardhome:latest', 'built-in')],
    [app('adguard', 'Adguard', 'docker.io/adguard/adguardhome', 'remote'), app('other', 'Other', '', 'remote')],
    [app('adguardhome-container', 'Adguardhome (container)', 'adguard/adguardhome:v0.107', 'remote2'), app('other2', 'Other 2', '', 'remote2')],
  ])
  assert.deepEqual(merged.map((a) => a.slug).sort(), ['adguard-home', 'other', 'other2'])
  assert.equal(imageKey('lscr.io/linuxserver/sonarr:4@sha256:abc'), 'linuxserver/sonarr')
  assert.equal(imageKey('library/ghost:5'), 'ghost')
})
