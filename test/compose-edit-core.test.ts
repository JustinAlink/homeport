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
