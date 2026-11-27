import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portScope, routeAccess, plainHttpServed, exposureOf, exposureSummary, sortExposure, ackKey, sanitizeAcksBackup, type ExposureInput } from '../shared/utils/exposure.ts'

const app = (over: Partial<ExposureInput> = {}): ExposureInput => ({
  id: 'h::1',
  key: 'h|qbittorrent',
  name: 'qbittorrent',
  image: 'lscr.io/linuxserver/qbittorrent:5.0.0',
  isProxy: false,
  ports: [],
  domains: [],
  ...over,
})
const ALL = ['0.0.0.0', '::']
const route = (domain: string, ssl = true, via: 'name' | 'ip' = 'name') => ({ domain, url: `${ssl ? 'https' : 'http'}://${domain}`, ssl, via })

test('portScope: no address is Docker’s default (every interface); loopback and a specific IP are not', () => {
  assert.equal(portScope(undefined), 'all')
  assert.equal(portScope([]), 'all')
  assert.equal(portScope(ALL), 'all')
  assert.equal(portScope(['::']), 'all')
  assert.equal(portScope(['127.0.0.1']), 'loopback')
  assert.equal(portScope(['127.0.0.1', '::1']), 'loopback')
  assert.equal(portScope(['192.168.1.5']), 'specific')
  assert.equal(portScope(['127.0.0.1', '100.64.0.7']), 'specific')
})

test('routeAccess: tells a sign-in portal and an app login from a page anyone can open', () => {
  const d = 'sonarr.example.com'
  assert.equal(routeAccess(undefined, d).access, 'unchecked')
  assert.equal(routeAccess({ status: 0 }, d).access, 'down')
  assert.equal(routeAccess({ status: 401 }, d).access, 'login')
  assert.equal(routeAccess({ status: 403 }, d).access, 'refused')
  assert.deepEqual(routeAccess({ status: 302, location: 'https://auth.example.com/?rd=https://sonarr.example.com/' }, d), { access: 'sso', signIn: 'auth.example.com' })
  assert.equal(routeAccess({ status: 302, location: 'https://id.example.com/if/flow/default-authentication-flow/' }, d).access, 'sso')
  assert.equal(routeAccess({ status: 302, location: '/login?next=/' }, d).access, 'login') // the app's own login
  assert.equal(routeAccess({ status: 302, location: '/web/index.html' }, d).access, 'open') // an in-app redirect
  assert.equal(routeAccess({ status: 301, location: 'https://www.example.com/' }, 'example.com').access, 'open')
  assert.equal(routeAccess({ status: 200 }, d).access, 'open')
  assert.equal(routeAccess({ status: 502 }, d).access, 'error')
})

test('plainHttpServed: a redirect to https is fine, the app or a password prompt over http is not', () => {
  assert.equal(plainHttpServed(undefined), null)
  assert.equal(plainHttpServed({ status: 301, location: 'https://a.example.com/' }), false)
  assert.equal(plainHttpServed({ status: 0 }), false)
  assert.equal(plainHttpServed({ status: 200 }), true)
  assert.equal(plainHttpServed({ status: 401 }), true)
  assert.equal(plainHttpServed({ status: 302, location: 'http://a.example.com/login' }), true)
})

test('exposure: a proxied app also open on every interface is reachable around the proxy', () => {
  const e = exposureOf(
    app({ domains: [route('qbit.example.com')], ports: [{ hostPort: 8090, containerPort: 8080, type: 'tcp', addrs: ALL }] }),
    { 'https://qbit.example.com': { status: 401, http: { status: 301, location: 'https://qbit.example.com/' } } },
  )
  assert.equal(e.level, 'risk')
  assert.equal(e.findings[0].code, 'around-proxy')
  assert.match(e.findings[0].detail, /or the login in front of it/) // the probe saw a login
  assert.match(e.findings[0].fix, /remove it from `ports:`/) // routed by name: the port isn't needed
  assert.match(e.findings[0].fix, /127\.0\.0\.1:8090:8080/)
  assert.deepEqual(e.findings[0].snippet, { from: '"8090:8080"', to: '"127.0.0.1:8090:8080"' })
  // routed through the published port instead: removing it would break the domain
  const byIp = exposureOf(app({ domains: [route('qbit.example.com', true, 'ip')], ports: [{ hostPort: 8090, containerPort: 8080, type: 'tcp', addrs: ALL }] }))
  assert.doesNotMatch(byIp.findings[0].fix, /remove it/)
  assert.equal(byIp.findings[0].snippet, undefined) // loopback would cut the proxy off
})

test('exposure: the same app bound to 127.0.0.1 is simply proxied', () => {
  const e = exposureOf(
    app({ domains: [route('qbit.example.com')], ports: [{ hostPort: 8090, containerPort: 8080, type: 'tcp', addrs: ['127.0.0.1'] }] }),
    { 'https://qbit.example.com': { status: 200, http: { status: 308, location: 'https://qbit.example.com/' } } },
  )
  assert.equal(e.level, 'proxied')
  assert.deepEqual(e.findings, [])
  assert.equal(e.ports[0].scope, 'loopback')
})

test('exposure: the proxy’s own 80/443 are its job, its admin port is not', () => {
  const npm = exposureOf(
    app({
      name: 'nginx-proxy-manager',
      image: 'jc21/nginx-proxy-manager:2.12.1',
      isProxy: true,
      domains: [route('npm.example.com')],
      ports: [80, 443, 81].map((p) => ({ hostPort: p, containerPort: p, type: 'tcp', addrs: ALL })),
    }),
  )
  assert.equal(npm.role, 'proxy')
  assert.deepEqual(npm.findings.map((f) => f.code), ['proxy-admin-open'])
  assert.deepEqual(npm.findings[0].ports, [81]) // only the admin port is the subject, not 80/443
  assert.equal(npm.level, 'warn')
  // only 80/443 published: nothing to say
  const quiet = exposureOf(app({ name: 'npm', image: 'jc21/nginx-proxy-manager:2', isProxy: true, ports: [80, 443].map((p) => ({ hostPort: p, containerPort: p, type: 'tcp', addrs: ALL })) }))
  assert.deepEqual(quiet.findings, [])
  assert.equal(quiet.level, 'proxied')
  // Caddy's admin API has no login: that one is red
  const caddy = exposureOf(app({ name: 'caddy', image: 'caddy:2', isProxy: true, ports: [{ hostPort: 2019, containerPort: 2019, type: 'tcp', addrs: ALL }] }))
  assert.equal(caddy.level, 'risk')
})

test('exposure: a container that controls Docker is only flagged when something can reach it', () => {
  const reachable = exposureOf(app({ name: 'portainer', image: 'portainer/portainer-ce:2.21.0', dockerSocket: true, domains: [route('portainer.example.com')] }))
  assert.deepEqual(reachable.findings.map((f) => f.code), ['docker-control'])
  assert.equal(reachable.level, 'risk')
  const internal = exposureOf(app({ name: 'socket-proxy', image: 'tecnativa/docker-socket-proxy:v0.5.0', dockerSocket: true }))
  assert.equal(internal.level, 'internal')
  // reachable through a port: one finding that carries the port fix, not two
  const byPort = exposureOf(app({ dockerSocket: true, ports: [{ hostPort: 9000, containerPort: 9000, type: 'tcp', addrs: ALL }] }))
  assert.deepEqual(byPort.findings.map((f) => f.code), ['docker-control'])
  assert.deepEqual(byPort.findings[0].snippet, { from: '"9000:9000"', to: '"127.0.0.1:9000:9000"' })
})

test('exposure: an open database is worth a look, other open ports are just open', () => {
  const pg = exposureOf(app({ name: 'umami-db', image: 'postgres:16-alpine', ports: [{ hostPort: 5432, containerPort: 5432, type: 'tcp', addrs: ALL }] }))
  assert.equal(pg.findings[0].code, 'database-open')
  assert.equal(pg.level, 'warn')
  for (const image of ['lscr.io/linuxserver/mariadb:11', 'redis:7', 'docker.io/library/mongo:7@sha256:abc']) {
    assert.equal(exposureOf(app({ image, ports: [{ hostPort: 1, containerPort: 1, type: 'tcp' }] })).findings[0].code, 'database-open', image)
  }
  // a tag that merely mentions postgres is not a database
  const umami = exposureOf(app({ image: 'ghcr.io/umami-software/umami:postgresql-latest', ports: [{ hostPort: 3000, containerPort: 3000, type: 'tcp', addrs: ALL }] }))
  assert.equal(umami.findings[0].code, 'open-port')
  assert.equal(umami.level, 'open')
})

test('exposure: HTTPS problems come from the route and the probe, and an unchecked route says nothing', () => {
  const plain = exposureOf(app({ domains: [route('legacy.example.com', false)] }))
  assert.equal(plain.findings[0].code, 'plain-http')
  const leaky = exposureOf(app({ domains: [route('blog.example.com')] }), { 'https://blog.example.com': { status: 200, http: { status: 200 } } })
  assert.equal(leaky.findings[0].code, 'http-not-redirected')
  const unchecked = exposureOf(app({ domains: [route('blog.example.com')] }))
  assert.deepEqual(unchecked.findings, [])
  assert.equal(unchecked.routes[0].access, 'unchecked')
})

test('exposure: nothing published and no route is internal; a LAN-bound port too', () => {
  assert.equal(exposureOf(app()).level, 'internal')
  assert.equal(exposureOf(app({ ports: [{ hostPort: 53, containerPort: 53, type: 'udp', addrs: ['192.168.1.2'] }] })).level, 'internal')
})

test('exposure: summary counts and worst-first order', () => {
  const list = [
    exposureOf(app({ id: 'a', name: 'b-internal' })),
    exposureOf(app({ id: 'b', name: 'a-risk', dockerSocket: true, domains: [route('x.example.com')] })),
    exposureOf(app({ id: 'c', name: 'c-open', ports: [{ hostPort: 25565, containerPort: 25565, type: 'tcp', addrs: ALL }] })),
  ]
  assert.deepEqual(exposureSummary(list), { risk: 1, warn: 0, open: 1, proxied: 0, internal: 1 })
  assert.deepEqual(sortExposure(list).map((e) => e.name), ['a-risk', 'c-open', 'b-internal'])
})

test('exposure: an accepted finding stops counting but stays visible with its reason', () => {
  // Plex-style: a domain, plus the LAN port the app needs anyway
  const plex = app({ key: 'h|plex', name: 'plex', domains: [route('plex.example.com')], ports: [{ hostPort: 32400, containerPort: 32400, type: 'tcp', addrs: ALL }] })
  assert.equal(exposureOf(plex).level, 'risk')
  const acks = { [ackKey('h|plex', 'around-proxy')]: { note: 'LAN clients need 32400', at: 1 } }
  const e = exposureOf(plex, {}, acks)
  assert.equal(e.level, 'proxied')
  assert.deepEqual(e.findings, [])
  assert.equal(e.accepted[0].code, 'around-proxy')
  assert.equal(e.accepted[0].note, 'LAN clients need 32400')
  // the acceptance is per rule: a new problem on the same container still shows
  const plainToo = exposureOf({ ...plex, domains: [route('plex.example.com', false)] }, {}, acks)
  assert.deepEqual(plainToo.findings.map((f) => f.code), ['plain-http'])
  // an accepted open port still reads as an open port
  const game = app({ key: 'h|mc', ports: [{ hostPort: 25565, containerPort: 25565, type: 'tcp', addrs: ALL }] })
  assert.equal(exposureOf(game, {}, { [ackKey('h|mc', 'open-port')]: { note: 'game server', at: 1 } }).level, 'open')
})

test('exposure: only the port the proxy forwards to is a way around it (found on a real fleet)', () => {
  // Pelican Wings: the panel's domain goes to its API on 8080, SFTP is open on 2022
  const wings = { domain: 'node.example.com', url: 'https://node.example.com', ssl: true, via: 'name' as const, port: 8080 }
  const sftpOnly = exposureOf(app({ key: 'h|wings', domains: [wings], ports: [{ hostPort: 2022, containerPort: 2022, type: 'tcp', addrs: ALL }] }))
  assert.deepEqual(sftpOnly.findings.map((f) => f.code), ['open-port']) // a separate way in, not a bypass
  assert.equal(sftpOnly.level, 'open')
  assert.match(sftpOnly.findings[0].detail, /isn’t the port the proxy forwards to/)
  // the forwarded port itself open too: that one is around the proxy
  const both = exposureOf(app({ key: 'h|wings', domains: [wings], ports: [{ hostPort: 8080, containerPort: 8080, type: 'tcp', addrs: ALL }, { hostPort: 2022, containerPort: 2022, type: 'tcp', addrs: ALL }] }))
  assert.deepEqual(both.findings.map((f) => f.code), ['around-proxy', 'open-port'])
  assert.deepEqual(both.findings[0].ports, [8080])
  // routed by host IP: the forward port is a host port
  const byIp = exposureOf(app({ domains: [{ ...wings, via: 'ip', port: 18080 }], ports: [{ hostPort: 18080, containerPort: 8080, type: 'tcp', addrs: ALL }] }))
  assert.equal(byIp.findings[0].code, 'around-proxy')
  // with the Docker socket, its own finding already names every open port
  const real = exposureOf(app({ key: 'h|wings', dockerSocket: true, domains: [wings], ports: [{ hostPort: 2022, containerPort: 2022, type: 'tcp', addrs: ALL }] }))
  assert.deepEqual(real.findings.map((f) => f.code), ['docker-control'])
})

test('exposure: a port published for tcp and udp is named once', () => {
  const mc = exposureOf(
    app({
      ports: [25565, 25565, 25566, 25566].map((p, i) => ({ hostPort: p, containerPort: p, type: i % 2 ? 'udp' : 'tcp', addrs: ALL })),
    }),
  )
  assert.match(mc.findings[0].detail, /^Ports 25565 and 25566 on /)
  assert.deepEqual(mc.findings[0].ports, [25565, 25566])
})

test('backup: accepted findings come back under Accept\'s own rules', () => {
  const out = sanitizeAcksBackup({
    [ackKey('default|plex', 'open-port')]: { note: ' LAN clients need 32400 ', at: 5 },
    [ackKey('default|db', 'database-open')]: { note: '' }, // no reason: not an acceptance
    [ackKey('default|x', 'made-up-code')]: { note: 'why' },
    'no-container-key|open-port': { note: 'why' },
    [ackKey('default|y', 'plain-http')]: 'not an object',
  })
  assert.deepEqual(out, { 'default|plex|open-port': { note: 'LAN clients need 32400', at: 5 } })
  assert.deepEqual(sanitizeAcksBackup([]), {})
})
