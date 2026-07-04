import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHelperPayload, selfUpdatePlan, HELPER_LABEL } from '../server/utils/self-update-core.ts'

const INSPECT = {
  Config: {
    Image: 'ghcr.io/justinalink/homeport:latest',
    Labels: {
      'com.docker.compose.project': 'homeport',
      'com.docker.compose.project.working_dir': '/home/juniper/docker/homeport',
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
  })
  assert.match(pay.name, /^homeport-self-update-/)
  assert.equal(pay.Image, 'ghcr.io/justinalink/homeport:latest')
  assert.match(pay.Cmd[0], /compose -p homeport pull && docker compose -p homeport up -d/)
  assert.ok(pay.Env.includes('DOCKER_HOST=tcp://docker-socket-proxy:2375'))
  assert.deepEqual(pay.HostConfig.Binds, ['/home/juniper/docker/homeport:/project'])
  assert.equal(pay.HostConfig.AutoRemove, true)
  assert.equal(pay.Labels[HELPER_LABEL], 'true')
  assert.ok(pay.NetworkingConfig?.EndpointsConfig?.homeport_internal)
})
