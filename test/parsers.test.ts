import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseConf } from '../server/utils/providers/npm.ts'
import { parseTraefikContainer } from '../server/utils/providers/traefik.ts'
import { parseCaddyfile } from '../server/utils/providers/caddy.ts'
import { parseNginxConf } from '../server/utils/providers/nginx.ts'
import { parseTraefikFile } from '../server/utils/providers/traefik-file.ts'
import { parseDockerHost } from '../server/utils/docker-target.ts'
import { parseSystemctlJson } from '../server/utils/systemd.ts'

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const read = (p: string) => readFileSync(join(dir, p), 'utf8')

test('npm: container-name upstream', () => {
  assert.deepEqual(parseConf(read('npm/app.conf')), {
    domains: ['app.example.com', 'www.app.example.com'],
    upstreamHost: 'webapp',
    upstreamPort: 8080,
    ssl: true,
  })
})

test('npm: host-IP upstream', () => {
  const r = parseConf(read('npm/hostport.conf'))
  assert.equal(r?.upstreamHost, '172.17.0.1')
  assert.equal(r?.upstreamPort, 9000)
})

test('traefik: labels → route (single host, tls, port)', () => {
  const fx = JSON.parse(read('traefik-labels.json'))
  assert.deepEqual(parseTraefikContainer('blog', fx[0].labels), {
    domains: ['blog.example.com'],
    upstreamHost: 'blog',
    upstreamPort: 2368,
    ssl: true,
  })
})

test('traefik: multiple hosts + websecure entrypoint', () => {
  const fx = JSON.parse(read('traefik-labels.json'))
  const api = parseTraefikContainer('api', fx[1].labels)
  assert.deepEqual(api?.domains, ['api.example.com', 'api2.example.com'])
  assert.equal(api?.ssl, true)
  assert.equal(api?.upstreamPort, 80) // no explicit port → default
})

test('traefik: disabled / no labels → null', () => {
  const fx = JSON.parse(read('traefik-labels.json'))
  assert.equal(parseTraefikContainer('disabled', fx[2].labels), null)
  assert.equal(parseTraefikContainer('nolabels', fx[3].labels), null)
})

test('docker-host: ssh / tcp / socket', () => {
  assert.deepEqual(parseDockerHost('ssh://juniper@vps.example.com'), {
    kind: 'ssh',
    host: 'vps.example.com',
    port: 22,
    username: 'juniper',
  })
  assert.deepEqual(parseDockerHost('ssh://core@10.0.0.5:2222'), {
    kind: 'ssh',
    host: '10.0.0.5',
    port: 2222,
    username: 'core',
  })
  assert.deepEqual(parseDockerHost('tcp://docker-socket-proxy:2375'), {
    kind: 'tcp',
    host: 'docker-socket-proxy',
    port: 2375,
  })
  assert.equal(parseDockerHost('').kind, 'socket')
  assert.equal(parseDockerHost('/var/run/docker.sock').kind, 'socket')
})

test('systemd: parse json, keep only .service units', () => {
  const units = parseSystemctlJson(read('systemctl.json'))
  assert.equal(units.length, 3) // .mount and .timer filtered out
  assert.deepEqual(
    units.map((u) => u.unit),
    ['nginx.service', 'postgresql.service', 'fail2ban.service'],
  )
  assert.equal(units.find((u) => u.unit === 'fail2ban.service')?.active, 'failed')
  assert.deepEqual(parseSystemctlJson('not json'), [])
})

test('caddy: simple + multi-domain + http(no tls) + nested to', () => {
  const routes = parseCaddyfile(read('Caddyfile'))
  const by = (d: string) => routes.find((r) => r.domains.includes(d))
  assert.equal(by('app.example.com')?.upstreamHost, 'myapp')
  assert.equal(by('app.example.com')?.upstreamPort, 8080)
  assert.deepEqual(by('blog.example.com')?.domains, ['blog.example.com', 'www.blog.example.com'])
  const internal = by('internal.example.com')
  assert.equal(internal?.ssl, false)
  assert.equal(internal?.upstreamHost, 'backend')
  assert.equal(internal?.upstreamPort, 3000)
})

test('nginx: upstream resolution + ssl + direct host:port', () => {
  const routes = parseNginxConf(read('nginx/site.conf'))
  const by = (d: string) => routes.find((r) => r.domains.includes(d))
  const blog = by('blog.example.com')
  assert.deepEqual(blog?.domains, ['blog.example.com', 'www.blog.example.com'])
  assert.equal(blog?.upstreamHost, 'ghost') // resolved via upstream blog_backend → ghost:2368
  assert.equal(blog?.upstreamPort, 2368)
  assert.equal(blog?.ssl, true)
  const app = by('app.example.com')
  assert.equal(app?.upstreamHost, '10.0.0.5')
  assert.equal(app?.upstreamPort, 8080)
  assert.equal(app?.ssl, false)
})

test('traefik-file: yaml routers → services (tls + entrypoints, multi-host rule)', () => {
  const routes = parseTraefikFile(read('traefik-file.yml'), 'yaml')
  const by = (d: string) => routes.find((r) => r.domains.includes(d))
  const blog = by('blog.example.com')
  assert.equal(blog?.upstreamHost, 'ghost')
  assert.equal(blog?.upstreamPort, 2368)
  assert.equal(blog?.ssl, true) // tls: {}
  const api = by('api.example.com')
  assert.deepEqual(api?.domains, ['api.example.com', 'api2.example.com'])
  assert.equal(api?.upstreamHost, '10.0.0.9')
  assert.equal(api?.upstreamPort, 9000)
  assert.equal(api?.ssl, true) // entryPoints: [websecure]
})

test('traefik-file: toml format', () => {
  const toml = `
[http.routers.web]
rule = "Host(\`site.example.com\`)"
service = "web-svc"
[http.routers.web.tls]
[http.services.web-svc.loadBalancer]
[[http.services.web-svc.loadBalancer.servers]]
url = "http://web:3000"
`
  const routes = parseTraefikFile(toml, 'toml')
  assert.equal(routes.length, 1)
  assert.deepEqual(routes[0].domains, ['site.example.com'])
  assert.equal(routes[0].upstreamHost, 'web')
  assert.equal(routes[0].upstreamPort, 3000)
  assert.equal(routes[0].ssl, true)
})
