import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findProxyName, imageRepoOf, routeOrder, localDomainUrls, proxyForDomains } from '../server/utils/ping-core.ts'

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

test('localDomainUrls: only the own host’s domains may use its proxy as the fallback', () => {
  const services = [
    { host: 'vps', domains: [{ url: 'https://app.example.com' }] },
    { host: 'nas', domains: [{ url: 'https://media.example.com' }] },
    { domains: [{ url: 'https://single.example.com' }] }, // single-host setups carry no host
  ]
  const local = localDomainUrls(services, 'vps')
  assert.deepEqual([...local].sort(), ['https://app.example.com', 'https://single.example.com'])
  // without a known local host name everything is local (the single-host case)
  assert.equal(localDomainUrls(services, undefined).size, 3)
})

test('each domain is checked through the proxy of its own source', () => {
  const c = (name: string, image: string, domains: { url: string; source?: string }[] = [], extra = {}) => ({ name, image, state: 'running', kind: 'container', domains, ...extra })
  // the real-software test: Caddy (caddy-docker-proxy) found first, Traefik beside it, a Newt tunnel too
  const services = [
    c('hp-ds-caddy', 'lucaslorentz/caddy-docker-proxy:2.13-alpine'),
    c('hp-ds-traefik', 'traefik:v3.8'),
    c('hp-ds-newt', 'fosrl/newt:1.20.1'),
    c('who', 'traefik/whoami', [{ url: 'http://who.ds.test', source: 'Traefik (API)' }]),
    c('cdp', 'traefik/whoami', [{ url: 'https://cdp.ds.test', source: 'caddy-docker-proxy' }]),
    c('pg', 'traefik/whoami', [{ url: 'https://pg.ds.test', source: 'Pangolin' }]),
    c('old', 'nginx', [{ url: 'http://old.example', source: 'Nginx' }]),
    c('remote', 'app', [{ url: 'http://far.example', source: 'Traefik (API)' }], { host: 'nas' }),
  ]
  const m = proxyForDomains(services, 'local')
  assert.equal(m.get('http://who.ds.test'), 'hp-ds-traefik') // not Caddy, which was found first
  assert.equal(m.get('https://cdp.ds.test'), 'hp-ds-caddy')
  assert.equal(m.get('https://pg.ds.test'), null) // a tunnel: no local proxy stands in (Traefik's 404 read as "up")
  assert.equal(m.get('http://old.example'), 'hp-ds-caddy') // an unknown source keeps the old guess
  assert.equal(m.has('http://far.example'), false) // another host's domain never goes through this host's proxy
  // a source whose proxy isn't running here gets no fallback rather than a wrong one
  const noTraefik = proxyForDomains(services.filter((s) => s.name !== 'hp-ds-traefik'), 'local')
  assert.equal(noTraefik.get('http://who.ds.test'), null)
})
