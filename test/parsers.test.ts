import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseConf } from '../server/utils/providers/npm.ts'
import { parseTraefikContainer } from '../server/utils/providers/traefik.ts'
import { parseCaddyfile } from '../server/utils/providers/caddy.ts'

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
