import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHelperPayload, selfUpdatePlan, selfIdPrefix, HELPER_LABEL } from '../server/utils/self-update-core.ts'

const INSPECT = {
  Config: {
    Image: 'ghcr.io/justinalink/homeport:latest',
    Labels: {
      'com.docker.compose.project': 'homeport',
      'com.docker.compose.project.working_dir': '/home/juniper/docker/homeport',
      'com.docker.compose.service': 'homeport',
    },
  },
  NetworkSettings: { Networks: { 'homeport_internal': {}, 'npm-network': {} } },
}

test('selfUpdatePlan: extracts compose project facts', () => {
  const p = selfUpdatePlan(INSPECT)
  assert.ok(p.ok)
  if (p.ok) {
    assert.equal(p.project, 'homeport')
    assert.equal(p.projectDir, '/home/juniper/docker/homeport')
    assert.equal(p.service, 'homeport')
    assert.deepEqual(p.networks, ['homeport_internal', 'npm-network'])
  }
})

test('selfUpdatePlan: refuses non-compose containers', () => {
  const p = selfUpdatePlan({ Config: { Image: 'x', Labels: {} } })
  assert.equal(p.ok, false)
  if (!p.ok) assert.match(p.reason, /compose/)
})

test('buildHelperPayload: detached, auto-removing, project-mounted, proxy-wired', () => {
  const pay = buildHelperPayload({
    image: 'ghcr.io/justinalink/homeport:latest',
    project: 'homeport',
    projectDir: '/home/juniper/docker/homeport',
    dockerHost: 'tcp://docker-socket-proxy:2375',
    networks: ['homeport_internal'],
    service: 'homeport',
  })
  assert.match(pay.name, /^homeport-self-update-/)
  assert.equal(pay.Image, 'ghcr.io/justinalink/homeport:latest')
  assert.match(pay.Cmd[0], /^cd '\/home\/juniper\/docker\/homeport' && docker compose -p 'homeport' pull/)
  assert.ok(pay.Env.includes('DOCKER_HOST=tcp://docker-socket-proxy:2375'))
  // SAME path on both sides — compose sends absolute bind paths to the daemon,
  // which resolves them on the HOST (the /project variant shipped a real bug)
  assert.deepEqual(pay.HostConfig.Binds, ['/home/juniper/docker/homeport:/home/juniper/docker/homeport'])
  assert.equal(pay.WorkingDir, '/home/juniper/docker/homeport')
  assert.equal(pay.HostConfig.AutoRemove, false)
  assert.equal(pay.Labels[HELPER_LABEL], 'true')
  assert.ok(pay.NetworkingConfig?.EndpointsConfig?.homeport_internal)
})

// Regression: a whole-project `up -d` also recreated the docker-socket-proxy the
// helper talks to, killing its own connection mid-update (2026-08-05).
test('buildHelperPayload: updates only homeport itself, never its socket-proxy sibling', () => {
  const cmd = buildHelperPayload({
    image: 'ghcr.io/justinalink/homeport:latest',
    project: 'homeport',
    projectDir: '/home/juniper/docker/homeport',
    dockerHost: 'tcp://docker-socket-proxy:2375',
    networks: ['homeport_internal'],
    service: 'homeport',
  }).Cmd[0]
  assert.match(cmd, /docker compose -p 'homeport' pull 'homeport' &&/)
  assert.match(cmd, /docker compose -p 'homeport' up -d --no-deps 'homeport'$/)
})

test('buildHelperPayload: no service label falls back to a whole-project update', () => {
  const cmd = buildHelperPayload({
    image: 'ghcr.io/justinalink/homeport:latest',
    project: 'homeport',
    projectDir: '/home/juniper/docker/homeport',
    dockerHost: '',
    networks: [],
  }).Cmd[0]
  assert.match(cmd, /pull && docker compose -p 'homeport' up -d$/)
})

test('selfIdPrefix: only a 12-hex container hostname counts as a container id', () => {
  assert.equal(selfIdPrefix('deadbeef1234'), 'deadbeef1234')
  assert.equal(selfIdPrefix('homeport'), null) // custom hostname: a prefix match could pick any container
  assert.equal(selfIdPrefix(''), null)
  assert.equal(selfIdPrefix('deadbeef12345'), null)
})

test('selfUpdatePlan: keeps every config file the project was started with', () => {
  const p = selfUpdatePlan({
    ...INSPECT,
    Config: {
      ...INSPECT.Config,
      Labels: {
        ...INSPECT.Config.Labels,
        'com.docker.compose.project.config_files': '/srv/homeport/docker-compose.yml,/srv/homeport/docker-compose.prod.yml',
      },
    },
  })
  assert.ok(p.ok)
  if (p.ok) assert.deepEqual(p.configFiles, ['/srv/homeport/docker-compose.yml', '/srv/homeport/docker-compose.prod.yml'])
})

// the command runs through `sh -c`: a project dir with a space broke `cd`, and
// the overlay file was dropped so the update changed what runs
test('buildHelperPayload: quotes paths and passes every config file to both compose calls', () => {
  const pay = buildHelperPayload({
    image: 'ghcr.io/justinalink/homeport:latest',
    project: 'homeport',
    projectDir: "/srv/my stacks/home'port",
    dockerHost: '',
    networks: [],
    service: 'homeport',
    configFiles: ["/srv/my stacks/home'port/docker-compose.yml", '/etc/homeport/prod.yml'],
  })
  const cmd = pay.Cmd[0]
  assert.ok(cmd.startsWith(`cd '/srv/my stacks/home'\\''port' && `), cmd)
  const files = ` -f '/srv/my stacks/home'\\''port/docker-compose.yml' -f '/etc/homeport/prod.yml'`
  assert.ok(cmd.includes(`-p 'homeport'${files} pull 'homeport'`), cmd)
  assert.ok(cmd.includes(`-p 'homeport'${files} up -d --no-deps 'homeport'`), cmd)
  // a file outside the project dir is mounted at its own path, read-only
  assert.deepEqual(pay.HostConfig.Binds, ["/srv/my stacks/home'port:/srv/my stacks/home'port", '/etc/homeport/prod.yml:/etc/homeport/prod.yml:ro'])
})
