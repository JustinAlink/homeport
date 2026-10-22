import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDocument } from 'yaml'
import { patchComposeService } from '../server/utils/compose-edit-core.ts'

const BASE = `# media stack
services:
  jellyfin:
    image: jellyfin/jellyfin:10.9.6 # pinned on purpose
    restart: unless-stopped
    ports:
      - "8096:8096"
  sonarr:
    image: lscr.io/linuxserver/sonarr
`
const svc = (yaml: string, name: string) => (parseDocument(yaml).toJS() as any).services[name]

test('restart policy is written and comments survive', () => {
  const out = patchComposeService(BASE, 'jellyfin', { restart: 'always' })
  assert.equal(svc(out, 'jellyfin').restart, 'always')
  assert.match(out, /# media stack/)
  assert.match(out, /# pinned on purpose/)
  assert.equal(svc(out, 'sonarr').image, 'lscr.io/linuxserver/sonarr') // siblings untouched
})

test('restart "no" is quoted so YAML 1.1 readers do not see a boolean', () => {
  const out = patchComposeService(BASE, 'sonarr', { restart: 'no' })
  assert.match(out, /restart: "no"/)
})

test('limits go to service-level cpus / mem_limit when there is no deploy block', () => {
  const out = patchComposeService(BASE, 'jellyfin', { cpus: 1.5, memory: '2g' })
  assert.equal(svc(out, 'jellyfin').cpus, 1.5)
  assert.equal(svc(out, 'jellyfin').mem_limit, '2g')
  assert.equal(svc(out, 'jellyfin').deploy, undefined)
})

test('limits go to deploy.resources.limits when the file already uses it, and clear the duplicates', () => {
  const withDeploy = BASE.replace(
    '    restart: unless-stopped\n',
    '    restart: unless-stopped\n    cpus: 4\n    mem_limit: 8g\n    deploy:\n      resources:\n        limits:\n          memory: 1g\n',
  )
  const out = patchComposeService(withDeploy, 'jellyfin', { cpus: 0.5, memory: '512m' })
  const j = svc(out, 'jellyfin')
  assert.deepEqual(j.deploy.resources.limits, { cpus: '0.5', memory: '512m' })
  assert.equal(j.cpus, undefined)
  assert.equal(j.mem_limit, undefined)
})

test('removing every limit also removes the emptied deploy block', () => {
  const withDeploy = BASE.replace('    restart: unless-stopped\n', '    restart: unless-stopped\n    deploy:\n      resources:\n        limits:\n          memory: 1g\n')
  const out = patchComposeService(withDeploy, 'jellyfin', { cpus: null, memory: null })
  assert.equal(svc(out, 'jellyfin').deploy, undefined)
})

test('undefined fields are left alone; bad input is refused', () => {
  const out = patchComposeService(BASE.replace('    restart: unless-stopped\n', '    restart: unless-stopped\n    mem_limit: 1g\n'), 'jellyfin', { cpus: 2 })
  assert.equal(svc(out, 'jellyfin').mem_limit, '1g')
  assert.throws(() => patchComposeService(BASE, 'nope', { restart: 'always' }), /not found/)
  assert.throws(() => patchComposeService(BASE, 'jellyfin', { memory: 'lots' }), /not a memory size/)
  assert.throws(() => patchComposeService('services: [oops', 'jellyfin', { cpus: 1 }), /YAML errors/)
})

test('attaching a network keeps the service on its own stack network and declares the external one', () => {
  const out = patchComposeService(BASE, 'jellyfin', { addNetwork: 'npm-network' })
  const doc = parseDocument(out).toJS() as any
  assert.deepEqual(doc.services.jellyfin.networks, ['default', 'npm-network'])
  assert.deepEqual(doc.networks, { 'npm-network': { external: true } })
  assert.equal(doc.services.sonarr.networks, undefined) // siblings untouched
  assert.match(out, /# pinned on purpose/)
  // idempotent
  assert.equal(patchComposeService(out, 'jellyfin', { addNetwork: 'npm-network' }), out)
})

test('attaching uses an existing declaration and the map form when the file already has them', () => {
  const file = `name: media
services:
  app:
    image: x
    networks:
      backend: {}
networks:
  backend: {}
  shared:
    name: proxy_net
    external: true
`
  const out = parseDocument(patchComposeService(file, 'app', { addNetwork: 'proxy_net' })).toJS() as any
  assert.deepEqual(Object.keys(out.services.app.networks), ['backend', 'shared'])
  assert.deepEqual(Object.keys(out.networks), ['backend', 'shared']) // no duplicate declaration
  const own = parseDocument(patchComposeService(file, 'app', { addNetwork: 'media_backend' })).toJS() as any
  assert.deepEqual(Object.keys(own.services.app.networks), ['backend']) // the stack's own network, already listed
})

test('detaching removes the service entry and an external declaration nobody uses any more', () => {
  const attached = patchComposeService(BASE, 'jellyfin', { addNetwork: 'npm-network' })
  const out = parseDocument(patchComposeService(attached, 'jellyfin', { removeNetwork: 'npm-network' })).toJS() as any
  assert.deepEqual(out.services.jellyfin.networks, ['default'])
  assert.equal(out.networks, undefined)
  // a service on network_mode can't join networks
  assert.throws(() => patchComposeService('services:\n  a:\n    image: x\n    network_mode: host\n', 'a', { addNetwork: 'n' }), /network_mode/)
})
