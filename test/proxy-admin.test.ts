import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProxyHostPayload, npmRouteFrom, pickCertificate, npmAccessFrom } from '../server/utils/proxy-admin/npm-admin-core.ts'
import { buildCaddyRoute, caddyRoutesFromConfig, findHttpsServer, HP_PREFIX } from '../server/utils/proxy-admin/caddy-admin-core.ts'
import { upsertRoute, removeRoute, listRoutes } from '../server/utils/proxy-admin/traefik-admin-core.ts'

const route = { domains: ['app.example.com'], upstreamHost: 'app', upstreamPort: 8080, ssl: true }

// ---- NPM ----

test('npm: payload uses cert + ssl_forced only when a cert is supplied', () => {
  const withCert = buildProxyHostPayload(route, 7)
  assert.equal(withCert.forward_host, 'app')
  assert.equal(withCert.forward_port, 8080)
  assert.equal(withCert.certificate_id, 7)
  assert.equal(withCert.ssl_forced, true)
  assert.deepEqual(withCert.meta, { homeport: true })

  const noCert = buildProxyHostPayload(route, 0)
  assert.equal(noCert.certificate_id, 0)
  assert.equal(noCert.ssl_forced, false)

  const noSsl = buildProxyHostPayload({ ...route, ssl: false }, 7)
  assert.equal(noSsl.certificate_id, 0) // ssl off → ignore cert
})

test('npm: route mapping + cert picker (exact + wildcard)', () => {
  assert.deepEqual(npmRouteFrom({ id: 3, domain_names: ['a.com'], forward_scheme: 'http', forward_host: 'web', forward_port: 80, certificate_id: 2, ssl_forced: true, enabled: 1 }), {
    id: '3',
    domains: ['a.com'],
    upstreamHost: 'web',
    upstreamPort: 80,
    ssl: true,
    managed: true,
  })
  const certs = [
    { id: 1, domain_names: ['other.com'] },
    { id: 5, domain_names: ['*.example.com'] },
  ]
  assert.equal(pickCertificate(['app.example.com'], certs), 5) // wildcard
  assert.equal(pickCertificate(['nope.org'], certs), 0)
})

// ---- Caddy ----

test('caddy: https server detection, route build, listing + managed flag', () => {
  const config = {
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [':443'],
            routes: [
              { '@id': 'homeport-app', match: [{ host: ['app.example.com'] }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'app:8080' }] }] },
              { match: [{ host: ['hand.example.com'] }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'svc:3000' }] }] },
            ],
          },
        },
      },
    },
  }
  assert.equal(findHttpsServer(config), 'srv0')

  const built = buildCaddyRoute(route, 'app')
  assert.equal(built['@id'], HP_PREFIX + 'app')
  assert.deepEqual(built.match[0].host, ['app.example.com'])
  assert.equal(built.handle[0].upstreams[0].dial, 'app:8080')

  const routes = caddyRoutesFromConfig(config)
  assert.equal(routes.length, 2)
  assert.equal(routes.find((r) => r.domains.includes('app.example.com'))?.managed, true)
  assert.equal(routes.find((r) => r.domains.includes('hand.example.com'))?.managed, false) // user route
})

// ---- Traefik file ----

test('traefik: upsert adds homeport keys without touching user routers', () => {
  const doc = {
    http: {
      routers: { userblog: { rule: 'Host(`blog.com`)', service: 'blog-svc' } },
      services: { 'blog-svc': { loadBalancer: { servers: [{ url: 'http://ghost:2368' }] } } },
    },
  }
  const next = upsertRoute(doc, route, 'app')
  assert.ok(next.http.routers['homeport-app'])
  assert.equal(next.http.routers['homeport-app'].service, 'homeport-app')
  assert.equal(next.http.services['homeport-app'].loadBalancer.servers[0].url, 'http://app:8080')
  // user router untouched, original doc not mutated
  assert.ok(next.http.routers.userblog)
  assert.equal(doc.http.routers['homeport-app'], undefined)
})

test('traefik: listRoutes flags managed, remove refuses non-homeport', () => {
  const doc = upsertRoute({ http: { routers: { userblog: { rule: 'Host(`blog.com`)', service: 'blog-svc' } } } }, route, 'app')
  const routes = listRoutes(doc)
  assert.equal(routes.find((r) => r.id === 'homeport-app')?.managed, true)
  assert.equal(routes.find((r) => r.id === 'userblog')?.managed, false)

  assert.throws(() => removeRoute(doc, 'userblog'), /non-homeport/)
  const removed = removeRoute(doc, 'homeport-app')
  assert.equal(removed.http.routers['homeport-app'], undefined)
})

test('npmAccessFrom: a default NPM user is told it sees only its own hosts (snake_case API)', () => {
  const a = npmAccessFrom({ email: 'homeport@example.com', roles: [], permissions: { visibility: 'user', proxy_hosts: 'manage', certificates: 'manage' } })
  assert.equal(a.canManage, true)
  assert.equal(a.admin, false)
  assert.equal(a.issues.length, 1)
  assert.match(a.issues[0].text, /only sees proxy hosts it created/)
})

test('npmAccessFrom: view-only proxy hosts turn management off (camelCase accepted too)', () => {
  const a = npmAccessFrom({ email: 'x', roles: [], permissions: { visibility: 'all', proxyHosts: 'view' } })
  assert.equal(a.canManage, false)
  assert.deepEqual(a.issues.map((i) => i.level), ['warn'])
  assert.match(a.issues[0].text, /not change them/)
  assert.equal(npmAccessFrom({ roles: [], permissions: { visibility: 'all', proxy_hosts: 'hidden' } }).canManage, false)
})

test('npmAccessFrom: the intended setup has no issues; an admin gets only a least-privilege hint', () => {
  assert.deepEqual(npmAccessFrom({ roles: [], permissions: { visibility: 'all', proxy_hosts: 'manage', certificates: 'view' } }).issues, [])
  const admin = npmAccessFrom({ roles: ['admin'], permissions: { visibility: 'user', proxy_hosts: 'view' } })
  assert.equal(admin.canManage, true)
  assert.deepEqual(admin.issues.map((i) => i.level), ['info'])
})
