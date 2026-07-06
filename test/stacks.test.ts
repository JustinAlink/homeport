import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findComposeFile,
  safeStackName,
  stackStatuses,
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
  assert.deepEqual(stacks.find((s) => s.name === 'media'), { name: 'media', state: 'running', running: 2, total: 2 })
  assert.deepEqual(stacks.find((s) => s.name === 'web'), { name: 'web', state: 'partial', running: 1, total: 2 })
  assert.deepEqual(stacks.find((s) => s.name === 'idle'), { name: 'idle', state: 'stopped', running: 0, total: 0 })
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
