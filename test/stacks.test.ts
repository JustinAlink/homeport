import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findComposeFile,
  safeStackName,
  stackStatuses,
  declaredServices,
  managedByOf,
  managedByOfFiles,
  composeArgs,
  externalProjectFromLabels,
  projectNameFromDir,
  composeProjectNameFromContent,
} from '../server/utils/stacks-core.ts'

test('findComposeFile: pick order', () => {
  assert.equal(findComposeFile(['docker-compose.yml', 'compose.yaml']), 'compose.yaml')
  assert.equal(findComposeFile(['docker-compose.yaml', 'docker-compose.yml']), 'docker-compose.yml')
  assert.equal(findComposeFile(['readme.md']), null)
})

test('safeStackName: traversal + charset guard', () => {
  assert.equal(safeStackName('media'), 'media')
  assert.equal(safeStackName('my_stack-2'), 'my_stack-2')
  assert.equal(safeStackName('../etc'), null)
  assert.equal(safeStackName('a/b'), null)
  assert.equal(safeStackName('.hidden'), null)
  assert.equal(safeStackName(''), null)
  assert.equal(safeStackName('x'.repeat(65)), null)
})

test('stackStatuses: running/partial/stopped + unmanaged projects', () => {
  const { stacks, unmanaged } = stackStatuses(
    ['media', 'web', 'idle'],
    [
      { project: 'media', state: 'running' },
      { project: 'media', state: 'running' },
      { project: 'web', state: 'running' },
      { project: 'web', state: 'exited' },
      { project: 'rogue', state: 'running' },
      { project: null, state: 'running' }, // standalone container — ignored
    ],
  )
  assert.deepEqual(stacks.find((s) => s.name === 'media'), { name: 'media', state: 'running', running: 2, total: 2, missing: [] })
  assert.deepEqual(stacks.find((s) => s.name === 'web'), { name: 'web', state: 'partial', running: 1, total: 2, missing: [] })
  assert.deepEqual(stacks.find((s) => s.name === 'idle'), { name: 'idle', state: 'stopped', running: 0, total: 0, missing: [] })
  assert.deepEqual(unmanaged, [{ name: 'rogue', running: 1, total: 1 }])
})

test('externalProjectFromLabels: working_dir + config_files extraction', () => {
  assert.deepEqual(
    externalProjectFromLabels({
      'com.docker.compose.project': 'pelican',
      'com.docker.compose.project.working_dir': '/home/user/docker/pelican',
      'com.docker.compose.project.config_files': '/home/user/docker/pelican/docker-compose.yml',
    }),
    { project: 'pelican', dir: '/home/user/docker/pelican', files: ['/home/user/docker/pelican/docker-compose.yml'] },
  )
  // multiple config files (overrides) survive as a list
  assert.deepEqual(
    externalProjectFromLabels({
      'com.docker.compose.project': 'web',
      'com.docker.compose.project.working_dir': '/srv/web',
      'com.docker.compose.project.config_files': '/srv/web/compose.yml,/srv/web/compose.prod.yml',
    })?.files,
    ['/srv/web/compose.yml', '/srv/web/compose.prod.yml'],
  )
  // relative or missing working_dir → not adoptable
  assert.equal(externalProjectFromLabels({ 'com.docker.compose.project': 'x' }), null)
  assert.equal(
    externalProjectFromLabels({ 'com.docker.compose.project': 'x', 'com.docker.compose.project.working_dir': 'rel/path' }),
    null,
  )
  assert.equal(externalProjectFromLabels({}), null)
})

test('projectNameFromDir: compose default-name rules', () => {
  assert.equal(projectNameFromDir('pelican'), 'pelican')
  assert.equal(projectNameFromDir('RobotDiscordBot'), 'robotdiscordbot')
  assert.equal(projectNameFromDir('My App!'), 'myapp')
  assert.equal(projectNameFromDir('_hidden'), 'hidden')
  assert.equal(projectNameFromDir('...'), null)
})

test('composeProjectNameFromContent: top-level name only', () => {
  assert.equal(composeProjectNameFromContent('name: myproj\nservices:\n  app:\n    image: nginx\n'), 'myproj')
  assert.equal(composeProjectNameFromContent('name: "quoted" # comment\nservices: {}\n'), 'quoted')
  assert.equal(composeProjectNameFromContent('services:\n  app:\n    container_name: notaproject\n'), null)
  assert.equal(composeProjectNameFromContent(''), null)
})

test('composeArgs: pull implies up -d', () => {
  assert.deepEqual(composeArgs('up'), [['up', '-d', '--remove-orphans']])
  assert.deepEqual(composeArgs('down'), [['down']])
  assert.deepEqual(composeArgs('pull'), [['pull'], ['up', '-d', '--remove-orphans']])
})

test('declaredServices: names, images and profile-gated services', () => {
  const d = declaredServices(`services:
  app:
    image: nginx:alpine
  worker:
    build: .
  debug:
    image: busybox
    profiles: [debug]
`)
  assert.deepEqual(d, [
    { name: 'app', image: 'nginx:alpine', optional: false },
    { name: 'worker', image: undefined, optional: false },
    { name: 'debug', image: 'busybox', optional: true },
  ])
  assert.equal(declaredServices('services: [broken'), null)
  assert.equal(declaredServices('version: "3"'), null)
})

test('stackStatuses: counts from the compose file, so down stacks and missing services show', () => {
  const declared = {
    media: [
      { name: 'jellyfin', image: 'jellyfin/jellyfin', optional: false },
      { name: 'sonarr', optional: false },
      { name: 'debug', optional: true },
    ],
    down: [{ name: 'db', image: 'postgres:16', optional: false }],
  }
  const { stacks } = stackStatuses(
    ['media', 'down'],
    [{ project: 'media', state: 'running', service: 'jellyfin' }],
    declared,
  )
  // sonarr was never created: 1 of 2 running, not "1/1"; the profile-only service doesn't count
  assert.deepEqual(stacks.find((s) => s.name === 'media'), {
    name: 'media', state: 'partial', running: 1, total: 2, missing: [{ name: 'sonarr' }],
  })
  // a stack that was taken down still lists what it would run
  assert.deepEqual(stacks.find((s) => s.name === 'down'), {
    name: 'down', state: 'stopped', running: 0, total: 1, missing: [{ name: 'db', image: 'postgres:16' }],
  })
})

test('managedByOf: a compose file can name the system that owns it', () => {
  assert.equal(managedByOf('x-homeport:\n  managed-by: juniperserver playbook\nservices:\n  app:\n    image: nginx\n'), 'juniperserver playbook')
  assert.equal(managedByOf('services:\n  app:\n    image: nginx\n'), null)
  assert.equal(managedByOf('x-homeport:\n  managed-by: ""\n'), null)
  assert.equal(managedByOf('x-homeport: [1, 2]\n'), null)
  assert.equal(managedByOf(': not yaml : ['), null)
})

test('managedByOfFiles: the marker may live in an override compose loads (mailcow-style)', () => {
  const marker = 'x-homeport:\n  managed-by: ansible\n'
  assert.equal(managedByOfFiles('services: {}\n', [null, marker, null]), 'ansible')
  assert.equal(managedByOfFiles(marker.replace('ansible', 'main file'), [marker]), 'main file') // main file wins
  assert.equal(managedByOfFiles('services: {}\n', [null, null]), null)
  assert.equal(managedByOfFiles(null, []), null)
})
