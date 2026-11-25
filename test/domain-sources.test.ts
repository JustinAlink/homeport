import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTraefikApi, hostsFromRule, fetchTraefikApi, apiBase, nextPage } from '../server/utils/providers/traefik-api.ts'
import { parseCaddyDockerProxyLabels } from '../server/utils/providers/caddy-docker-proxy.ts'
import { parsePangolinLabels } from '../server/utils/providers/pangolin.ts'
import { planSources, detectLabelProxies, readLabelSources, sourcesLabel, type SourceResult } from '../server/utils/providers/sources-core.ts'
import { joinRoutes } from '../server/utils/providers/join-core.ts'
import { maskHostSecrets, keptPassword, mergeHostSecrets } from '../server/utils/host-secrets-core.ts'
import type { Route } from '../server/utils/providers/types.ts'

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const json = (p: string) => JSON.parse(readFileSync(join(dir, p), 'utf8'))
const byDomain = (routes: Route[], d: string) => routes.filter((r) => r.domains.includes(d))

// ---- Traefik API -------------------------------------------------------------

test('traefik api: a recording from Traefik 3.6 (docker provider, container IPs, http+https pair)', () => {
  const routes = parseTraefikApi(json('traefik-api/recorded-v3.6-routers.json'), json('traefik-api/recorded-v3.6-services.json'))
  assert.deepEqual(routes, [
    { domains: ['a.example.com', 'b.example.com'], upstreamHost: '172.23.0.4', upstreamPort: 80, ssl: false, source: 'Traefik (API)' },
    // the web router (redirect) and the websecure router merge into one https domain
    { domains: ['whoami.example.com'], upstreamHost: '172.23.0.3', upstreamPort: 80, ssl: true, source: 'Traefik (API)' },
  ])
})

test('traefik api: multi-domain rules, a router without TLS, an IP upstream, replicas, canary, k8s', () => {
  const routes = parseTraefikApi(json('traefik-api/routers.json'), json('traefik-api/services.json'))
  // v2 Host(`a`, `b`) to a file service by name
  assert.deepEqual(byDomain(routes, 'a.example.com'), [{ domains: ['a.example.com', 'b.example.com'], upstreamHost: 'app', upstreamPort: 8080, ssl: true, source: 'Traefik (API)' }])
  // Host(`a`) || Host(`b`)
  assert.deepEqual(byDomain(routes, 'metrics.example.com')[0].domains, ['grafana.example.com', 'metrics.example.com'])
  // no tls on the router: plain http, to a host IP + port
  assert.deepEqual(byDomain(routes, 'intranet.example.com'), [{ domains: ['intranet.example.com'], upstreamHost: '192.168.1.20', upstreamPort: 5000, ssl: false, source: 'Traefik (API)' }])
  // every replica of a scaled service gets the domain
  assert.deepEqual(byDomain(routes, 'web.example.com').map((r) => r.upstreamHost), ['172.18.0.10', '172.18.0.11'])
  // a weighted (canary) service is followed to both branches, qualified with its provider
  assert.deepEqual(byDomain(routes, 'shop.example.com').map((r) => r.upstreamHost), ['shop-v1', 'shop-v2'])
  // kubernetes: the service name gets the router's provider suffix
  assert.equal(byDomain(routes, 'echo.k8s.example.com')[0].upstreamHost, '10.42.0.15')
})

test('traefik api: internal services, disabled routers and HostRegexp give no domains', () => {
  const routes = parseTraefikApi(json('traefik-api/routers.json'), json('traefik-api/services.json'))
  const all = routes.flatMap((r) => r.domains)
  assert.ok(!all.includes('traefik.example.com'), 'dashboard router points at api@internal')
  assert.ok(!all.includes('broken.example.com'), 'disabled router')
  assert.ok(!all.some((d) => d.includes('^') || d.includes('*')), 'HostRegexp is not a domain')
  const perUpstream = new Map<string, string[]>()
  for (const r of routes) perUpstream.set(`${r.upstreamHost}:${r.upstreamPort}`, [...(perUpstream.get(`${r.upstreamHost}:${r.upstreamPort}`) ?? []), ...r.domains])
  for (const [up, ds] of perUpstream) assert.equal(new Set(ds).size, ds.length, `each domain once for ${up}`)
})

test('traefik api: rule parsing', () => {
  assert.deepEqual(hostsFromRule('Host(`a.com`, `b.com`)'), ['a.com', 'b.com'])
  assert.deepEqual(hostsFromRule('(Host(`A.com`) || Host(`b.com`)) && PathPrefix(`/x`)'), ['a.com', 'b.com'])
  assert.deepEqual(hostsFromRule('HostHeader(`old.com`)'), ['old.com'])
  assert.deepEqual(hostsFromRule('Host(`a.com`) && !Host(`b.com`)'), ['a.com'])
  assert.deepEqual(hostsFromRule('HostRegexp(`{sub:[a-z]+}.example.com`)'), [])
  assert.deepEqual(hostsFromRule('HostSNI(`*`)'), [])
})

test('traefik api: base URL, credentials in the URL, next page', () => {
  assert.deepEqual(apiBase('http://traefik:8080/'), { base: 'http://traefik:8080', user: '', password: '' })
  assert.deepEqual(apiBase('http://traefik:8080/api'), { base: 'http://traefik:8080', user: '', password: '' })
  assert.deepEqual(apiBase('https://u:p%40ss@proxy.example.com/traefik/api/'), { base: 'https://proxy.example.com/traefik', user: 'u', password: 'p@ss' })
  assert.equal(apiBase('ftp://x'), null)
  assert.equal(nextPage('2', 1), 2)
  assert.equal(nextPage('1', 3), null) // Traefik says 1 on the last page
  assert.equal(nextPage(null, 1), null)
})

type Call = { url: string; init: RequestInit }
function fakeFetch(pages: Record<string, { status?: number; body?: unknown; next?: string; location?: string }>, calls: Call[]) {
  return async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const key = Object.keys(pages).find((k) => url.includes(k))
    const p = key ? pages[key] : { status: 404 }
    const headers = new Headers()
    if (p.next) headers.set('x-next-page', p.next)
    if (p.location) headers.set('location', p.location)
    return new Response(p.body === undefined ? 'not json' : JSON.stringify(p.body), { status: p.status ?? 200, headers })
  }
}

test('traefik api: follows X-Next-Page and sends basic auth', async () => {
  const calls: Call[] = []
  const routers = json('traefik-api/recorded-v3.6-routers.json')
  const f = fakeFetch({
    'routers?per_page=500&page=1': { body: routers.slice(0, 3), next: '2' },
    'routers?per_page=500&page=2': { body: routers.slice(3), next: '1' },
    'services?per_page=500&page=1': { body: json('traefik-api/recorded-v3.6-services.json'), next: '1' },
  }, calls)
  const r = await fetchTraefikApi('http://traefik:8080', { user: 'admin', password: 's3cret' }, f)
  assert.equal(r.routers.length, routers.length)
  assert.equal(calls.length, 3)
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Basic ${Buffer.from('admin:s3cret').toString('base64')}`)
  assert.equal(calls[0].init.redirect, 'manual', 'credentials never follow a redirect')
})

test('traefik api: errors are readable and never carry the password', async () => {
  const run = (pages: Parameters<typeof fakeFetch>[0]) =>
    fetchTraefikApi('http://admin:hunter2@traefik:8080', {}, fakeFetch(pages, [])).then(() => 'ok', (e: Error) => e.message)
  const refused = await run({ routers: { status: 401, body: [] }, services: { status: 401, body: [] } })
  assert.match(refused, /refused the login \(HTTP 401\)/)
  const moved = await run({ routers: { status: 302, location: 'https://traefik.example.com/api/http/routers' }, services: { body: [] } })
  assert.match(moved, /redirected to https:\/\/traefik\.example\.com/)
  const notApi = await run({ routers: { body: { hello: 1 } }, services: { body: [] } })
  assert.match(notApi, /did not answer with Traefik API JSON/)
  for (const m of [refused, moved, notApi]) assert.ok(!m.includes('hunter2'), m)
})

// ---- caddy-docker-proxy ---------------------------------------------------------

test('caddy-docker-proxy: a site, several sites, nested, matchers, literal and block upstreams', () => {
  const routes = parseCaddyDockerProxyLabels(json('caddy-docker-proxy-labels.json'))
  const src = 'caddy-docker-proxy'
  assert.deepEqual(byDomain(routes, 'whoami.example.com'), [{ domains: ['whoami.example.com'], upstreamHost: 'whoami', upstreamPort: 80, ssl: true, source: src }])
  // caddy_0 / caddy_1 on one container; http:// means no TLS; {{upstreams https 8443}} is the port
  assert.deepEqual(byDomain(routes, 'www.shop.example.com'), [{ domains: ['shop.example.com', 'www.shop.example.com'], upstreamHost: 'shop', upstreamPort: 3000, ssl: true, source: src }])
  assert.deepEqual(byDomain(routes, 'admin.shop.example.com'), [{ domains: ['admin.shop.example.com'], upstreamHost: 'shop', upstreamPort: 8443, ssl: false, source: src }])
  // handle_path.0_reverse_proxy with lowestExposedPort
  assert.equal(byDomain(routes, 'files.example.com')[0].upstreamPort, 8080)
  // "@ws {{upstreams}}": the matcher is skipped, no port means 80; reverse_proxy.header_up is not an upstream
  assert.deepEqual(byDomain(routes, 'chat.example.org')[0], { domains: ['chat.example.com', 'chat.example.org'], upstreamHost: 'chat', upstreamPort: 80, ssl: true, source: src })
  // a literal upstream points at another container
  assert.deepEqual(byDomain(routes, 'legacy.example.com')[0].upstreamHost, 'legacy-backend')
  assert.equal(byDomain(routes, 'legacy.example.com')[0].upstreamPort, 9000)
  // reverse_proxy { to {{upstreams 5000}} }
  assert.equal(byDomain(routes, 'block.example.com')[0].upstreamPort, 5000)
})

test('caddy-docker-proxy: global options, snippets, wildcards and other proxies\' labels give nothing', () => {
  const routes = parseCaddyDockerProxyLabels(json('caddy-docker-proxy-labels.json'))
  const upstreams = new Set(routes.map((r) => r.upstreamHost))
  assert.ok(!upstreams.has('caddy') && !upstreams.has('snippets') && !upstreams.has('traefik-only'))
  assert.equal(routes.length, 7)
})

// ---- Pangolin -------------------------------------------------------------------

test('pangolin: the docs example, one resource merged from two containers', () => {
  const routes = parsePangolinLabels(json('pangolin-labels.json'))
  assert.deepEqual(byDomain(routes, 'nginx.example.com'), [
    // targets[0] has no hostname or port: this container and its exposed port
    { domains: ['nginx.example.com'], upstreamHost: 'nginx1', upstreamPort: 80, ssl: true, source: 'Pangolin' },
    { domains: ['nginx.example.com'], upstreamHost: 'nginx2', upstreamPort: 80, ssl: true, source: 'Pangolin' },
  ])
})

test('pangolin: defaults, disabled targets, ssl=false, IP targets, the old proxy-resources name', () => {
  const routes = parsePangolinLabels(json('pangolin-labels.json'))
  // lowest exposed port when unset; the disabled targets[1] is skipped; domain lowercased
  assert.deepEqual(byDomain(routes, 'wiki.example.com'), [{ domains: ['wiki.example.com'], upstreamHost: 'wiki', upstreamPort: 3000, ssl: true, source: 'Pangolin' }])
  assert.deepEqual(byDomain(routes, 'nas.example.com'), [{ domains: ['nas.example.com'], upstreamHost: '192.168.1.20', upstreamPort: 5001, ssl: false, source: 'Pangolin' }])
  assert.equal(byDomain(routes, 'old.example.com')[0].upstreamPort, 8080)
  // a domain and no target fields at all: the one container that carries it
  assert.deepEqual(byDomain(routes, 'solo.example.com')[0], { domains: ['solo.example.com'], upstreamHost: 'solo', upstreamPort: 8000, ssl: true, source: 'Pangolin' })
})

test('pangolin: tcp resources, disabled resources and wildcards have no domain', () => {
  const routes = parsePangolinLabels(json('pangolin-labels.json'))
  const all = routes.flatMap((r) => r.domains)
  assert.ok(!all.includes('git.example.com'))
  assert.ok(!all.some((d) => d.includes('*')))
  assert.equal(routes.filter((r) => r.upstreamHost === 'gitea').length, 0)
})

// ---- how sources combine ----------------------------------------------------------

test('sources: an NPM host reads exactly what it read before (no Traefik labels)', () => {
  assert.deepEqual(planSources({ npmConfDir: '/npm/proxy_host' }), { primary: 'npm', labels: [], detect: ['caddy-docker-proxy', 'pangolin'], explicitLabels: false })
  assert.deepEqual(planSources({ domainProvider: 'npm', npmConfDir: '/npm' }).primary, 'npm')
  // explicit with its path missing: nothing, as before
  assert.equal(planSources({ domainProvider: 'npm' }).primary, null)
  assert.deepEqual(planSources({ domainProvider: 'npm' }).labels, [])
})

test('sources: auto order unchanged; the API wins over the Traefik file; nothing configured = Traefik labels', () => {
  assert.equal(planSources({ npmConfDir: '/a', traefikApiUrl: 'http://t:8080' }).primary, 'npm')
  assert.equal(planSources({ caddyfilePath: '/c', nginxConfDir: '/n' }).primary, 'caddy')
  assert.equal(planSources({ traefikFilePath: '/t', traefikApiUrl: 'http://t:8080' }).primary, 'traefik-api')
  assert.deepEqual(planSources({}), { primary: null, labels: ['traefik'], detect: ['caddy-docker-proxy', 'pangolin'], explicitLabels: false })
  // the API already holds the Docker provider's routers: no double read of Traefik labels
  assert.deepEqual(planSources({ traefikApiUrl: 'http://t:8080' }).labels, [])
})

test('sources: an explicit label source is read without the detection gate', () => {
  assert.deepEqual(planSources({ domainProvider: 'pangolin' }), { primary: null, labels: ['pangolin'], detect: ['caddy-docker-proxy'], explicitLabels: true })
  assert.deepEqual(planSources({ domainProvider: 'caddy-docker-proxy' }).labels, ['caddy-docker-proxy'])
  assert.equal(planSources({ domainProvider: 'traefik-api', traefikApiUrl: 'http://t:8080' }).primary, 'traefik-api')
})

test('detection: caddy-docker-proxy by image or command, Pangolin by Newt or the CLI', () => {
  assert.deepEqual([...detectLabelProxies([{ image: 'lucaslorentz/caddy-docker-proxy:ci-alpine' }])], ['caddy-docker-proxy'])
  assert.deepEqual([...detectLabelProxies([{ image: 'ghcr.io/me/caddy-cloudflare:2', command: '/bin/caddy docker-proxy' }])], ['caddy-docker-proxy'])
  assert.deepEqual([...detectLabelProxies([{ image: 'fosrl/newt:1.5.2' }])], ['pangolin'])
  assert.deepEqual([...detectLabelProxies([{ image: 'docker.io/fosrl/pangolin-cli@sha256:abc' }])], ['pangolin'])
  // plain Caddy and Pangolin's own server stack are not label readers
  assert.equal(detectLabelProxies([{ image: 'caddy:2', command: 'caddy run --config /etc/caddy/Caddyfile' }, { image: 'fosrl/pangolin:1' }, { image: 'fosrl/gerbil:1' }]).size, 0)
})

test('sources: caddy and pangolin labels count only while their proxy is on the host', () => {
  const caddy = json('caddy-docker-proxy-labels.json')
  const pangolin = json('pangolin-labels.json')
  const withoutProxies = [...caddy.slice(1), ...pangolin.slice(1)]
  const plan = planSources({ npmConfDir: '/npm' })
  assert.deepEqual(readLabelSources(plan, withoutProxies), [])
  const names = readLabelSources(plan, [...caddy, ...pangolin]).map((r) => [r.name, r.routes.length])
  assert.deepEqual(names, [['caddy-docker-proxy', 7], ['Pangolin', 6]])
})

test('sources: what "domains via ..." names', () => {
  const r = (name: string, n: number, configured: boolean): SourceResult => ({ name, routes: Array(n).fill({}), configured })
  // the Traefik fallback with nothing found is not a provider (keeps the no-proxy hint)
  assert.equal(sourcesLabel([r('Traefik', 0, false)]), null)
  assert.equal(sourcesLabel([r('Traefik', 3, false)]), 'Traefik')
  assert.equal(sourcesLabel([r('Nginx Proxy Manager', 0, true)]), 'Nginx Proxy Manager')
  assert.equal(sourcesLabel([r('Nginx Proxy Manager', 4, true), r('Pangolin', 2, false), r('caddy-docker-proxy', 0, false)]), 'Nginx Proxy Manager + Pangolin')
})

// ---- joining routes to containers ---------------------------------------------------

const containers = [
  { id: 'npm', name: 'npm', ports: [{ hostPort: 80 }, { hostPort: 443 }], ips: ['172.23.0.2'] },
  { id: 'w1', name: 'hp-domains-whoami1', ports: [], ips: ['172.23.0.3'] },
  { id: 'w2', name: 'hp-domains-whoami2', ports: [], ips: ['172.23.0.4', 'fd00::4'] },
  { id: 'dsm', name: 'dsm', ports: [{ hostPort: 5000 }], ips: ['172.17.0.9'] },
  { id: 'wiki', name: 'wiki', ports: [], ips: [] },
]

test('join: a container-IP upstream lands on that container, not on whoever publishes the port', () => {
  const routes = parseTraefikApi(json('traefik-api/recorded-v3.6-routers.json'), json('traefik-api/recorded-v3.6-services.json'))
  const { domainsById, unmatched } = joinRoutes(routes, containers)
  assert.deepEqual(domainsById.get('w1'), [{ domain: 'whoami.example.com', url: 'https://whoami.example.com', ssl: true, via: 'name', port: 80, source: 'Traefik (API)' }])
  assert.deepEqual(domainsById.get('w2')?.map((d) => d.domain), ['a.example.com', 'b.example.com'])
  assert.equal(domainsById.get('npm'), undefined, 'npm publishes :80 but is not 172.23.0.3')
  assert.deepEqual(unmatched, [])
})

test('join: host IP + published port still works; IPv6 container IPs match; unmatched keep their source', () => {
  const routes: Route[] = [
    { domains: ['nas.example.com'], upstreamHost: '172.17.0.1', upstreamPort: 5000, ssl: true, source: 'Nginx Proxy Manager' },
    { domains: ['v6.example.com'], upstreamHost: 'fd00::4', upstreamPort: 80, ssl: true },
    { domains: ['gone.example.com'], upstreamHost: '10.42.0.15', upstreamPort: 8080, ssl: true, source: 'Traefik (API)' },
    { domains: ['solo.example.com'], upstreamHost: 'nowhere', upstreamPort: 0, ssl: true, source: 'Pangolin' },
  ]
  const { domainsById, unmatched } = joinRoutes(routes, containers)
  assert.equal(domainsById.get('dsm')?.[0].via, 'ip')
  assert.equal(domainsById.get('dsm')?.[0].port, 5000)
  assert.equal(domainsById.get('w2')?.[0].domain, 'v6.example.com')
  assert.deepEqual(unmatched, [
    { domains: ['gone.example.com'], upstream: '10.42.0.15:8080', ssl: true, source: 'Traefik (API)' },
    { domains: ['solo.example.com'], upstream: 'nowhere', ssl: true, source: 'Pangolin' },
  ])
})

test('join: the same domain from two sources shows once, HTTPS winning', () => {
  const routes: Route[] = [
    { domains: ['wiki.example.com'], upstreamHost: 'wiki', upstreamPort: 3000, ssl: false, source: 'Traefik' },
    { domains: ['wiki.example.com'], upstreamHost: 'wiki', upstreamPort: 3000, ssl: true, source: 'Pangolin' },
    { domains: ['wiki.example.com'], upstreamHost: 'wiki', upstreamPort: 3000, ssl: false, source: 'caddy-docker-proxy' },
  ]
  const d = joinRoutes(routes, containers).domainsById.get('wiki')!
  assert.equal(d.length, 1)
  assert.equal(d[0].url, 'https://wiki.example.com')
  assert.equal(d[0].source, 'Pangolin')
})

// ---- the Traefik API password in settings --------------------------------------------

test('host secrets: the password never reaches the view, only a flag', () => {
  const view = maskHostSecrets([{ name: 'vps', traefikApiUrl: 'http://t:8080', traefikApiPassword: 'pw' }, { name: 'nas' }])
  assert.deepEqual(view.map((h) => [h.traefikApiPassword, h.traefikApiPasswordSet]), [['', true], ['', false]])
  assert.ok(!JSON.stringify(view).includes('"pw"'))
})

test('host secrets: blank keeps the password only for the same host and the same server', () => {
  assert.equal(keptPassword('', 'pw', 'http://traefik:8080', 'http://traefik:8080/'), 'pw')
  assert.equal(keptPassword('new', 'pw', 'http://traefik:8080', 'http://traefik:8080'), 'new')
  // a new server never gets the old password without it being typed again
  assert.equal(keptPassword('', 'pw', 'http://evil.example.com:8080', 'http://traefik:8080'), '')
  assert.equal(keptPassword('', 'pw', '', 'http://traefik:8080'), '')

  const stored = [
    { id: 'a', name: 'vps', traefikApiUrl: 'http://t:8080', traefikApiPassword: 'pw-a' },
    { name: 'nas', traefikApiUrl: 'http://t2:8080', traefikApiPassword: 'pw-nas' },
  ]
  // the first row was deleted: the remaining one must not inherit its password by position
  const merged = mergeHostSecrets([{ name: 'nas', traefikApiUrl: 'http://t2:8080', traefikApiPassword: '' }], stored)
  assert.equal(merged[0].traefikApiPassword, 'pw-nas')
  const renamed = mergeHostSecrets([{ id: 'a', name: 'vps-renamed', traefikApiUrl: 'http://t:8080', traefikApiPassword: '' }], stored)
  assert.equal(renamed[0].traefikApiPassword, 'pw-a')
  const fresh = mergeHostSecrets([{ name: 'new-host', traefikApiUrl: 'http://t:8080', traefikApiPassword: '' }], stored)
  assert.equal(fresh[0].traefikApiPassword, '')
})

test('host secrets: per-host NPM API password is masked and survives a save', () => {
  const stored = [{ id: 'a', name: 'vps', npmApiUrl: 'http://npm:81', npmApiIdentity: 'me@example.com', npmApiSecret: 'npm-pw', caddyAdminUrl: 'http://caddy:2019' }]
  const view = maskHostSecrets(stored)
  assert.equal(view[0].npmApiSecret, '')
  assert.equal(view[0].npmApiSecretSet, true)
  assert.ok(!JSON.stringify(view).includes('npm-pw'))
  // the settings page sends rows without the per-host NPM/Caddy fields: all kept
  const saved = mergeHostSecrets([{ id: 'a', name: 'vps' }], stored)
  assert.deepEqual([saved[0].npmApiUrl, saved[0].npmApiIdentity, saved[0].npmApiSecret, saved[0].caddyAdminUrl], ['http://npm:81', 'me@example.com', 'npm-pw', 'http://caddy:2019'])
  // a blank password with the same server keeps it; another server drops it
  assert.equal(mergeHostSecrets([{ id: 'a', npmApiUrl: 'http://npm:81/', npmApiSecret: '' }], stored)[0].npmApiSecret, 'npm-pw')
  assert.equal(mergeHostSecrets([{ id: 'a', npmApiUrl: 'http://elsewhere:81', npmApiSecret: '' }], stored)[0].npmApiSecret, '')
  // an explicit empty URL clears it rather than keeping it
  assert.equal(mergeHostSecrets([{ id: 'a', npmApiUrl: '' }], stored)[0].npmApiUrl, '')
})
