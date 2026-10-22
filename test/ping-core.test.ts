import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findProxyName, imageRepoOf, routeOrder } from '../server/utils/ping-core.ts'

test('the proxy container is found by image, running, on this host', () => {
  const svcs = [
    { name: 'web', image: 'nginx:alpine', state: 'running' },
    { name: 'old-npm', image: 'jc21/nginx-proxy-manager:2.11', state: 'exited' },
    { name: 'nginx-proxy-manager', image: 'jc21/nginx-proxy-manager:2.16.0', state: 'running' },
  ]
  assert.equal(findProxyName(svcs), 'nginx-proxy-manager')
  assert.equal(findProxyName([{ name: 't', image: 'docker.io/library/traefik:v3.1', state: 'running' }]), 't')
  assert.equal(findProxyName([{ name: 'remote', image: 'traefik:v3', state: 'running', host: 'pi' }], 'local'), null)
  assert.equal(findProxyName([{ name: 'web', image: 'nginx', state: 'running' }]), null)
  assert.equal(imageRepoOf('ghcr.io/foo/caddy:2'), 'foo/caddy') // a lookalike from another org is not the proxy
})

test('route order: public first, the proxy first only while the public route is known to fail', () => {
  assert.deepEqual(routeOrder(undefined, 1000, true), ['public', 'proxy'])
  assert.deepEqual(routeOrder(5000, 1000, true), ['proxy', 'public'])
  assert.deepEqual(routeOrder(500, 1000, true), ['public', 'proxy'])
  assert.deepEqual(routeOrder(5000, 1000, false), ['public'])
})
