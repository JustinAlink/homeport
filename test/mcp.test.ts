import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleMcpPost, capText, decodeHeaderValue, validateArgs, RPC, SUPPORTED_VERSIONS, MAX_TOOL_TEXT, type McpServer } from '../server/utils/mcp-core.ts'
import { fleetTools, normDomain, domainMatches, problemOf, resolveService, SERVER_INSTRUCTIONS, MAX_LOG_LINES, type FleetSource, type LogLineLike } from '../server/utils/mcp-tools-core.ts'
import { exposureOf, exposureInput, exposureSummary, sortExposure } from '../shared/utils/exposure.ts'
import type { Service } from '../types/service.ts'

// ---------- a small fixed fleet ----------

function svc(p: Partial<Service> & { name: string }): Service {
  return {
    id: `h1::${p.name}-id`,
    kind: 'container',
    displayName: p.name,
    image: `${p.name}:1.0`,
    state: 'running',
    statusText: 'Up 2 days',
    health: null,
    createdAt: 1_700_000_000_000,
    ports: [],
    group: 'apps',
    project: 'apps',
    icon: null,
    domains: [],
    hidden: false,
    noalert: false,
    ...p,
  }
}

const SERVICES: Service[] = [
  svc({ name: 'npm', image: 'jc21/nginx-proxy-manager:2.12', ports: [{ hostPort: 443, containerPort: 443, type: 'tcp', addrs: ['0.0.0.0'] }] }),
  svc({ name: 'jellyfin', domains: [{ domain: 'media.example.com', url: 'https://media.example.com', ssl: true, via: 'name', port: 8096 }], ports: [{ hostPort: 8096, containerPort: 8096, type: 'tcp' }] }),
  svc({ name: 'wiki', domains: [{ domain: '*.wiki.example.com', url: 'https://*.wiki.example.com', ssl: true, via: 'name', port: 3000 }] }),
  svc({ name: 'db', image: 'postgres:16', health: 'unhealthy', statusText: 'Up 1 hour (unhealthy)' }),
  svc({ name: 'worker', state: 'restarting', statusText: 'Restarting (1) 3 seconds ago' }),
  svc({ name: 'backup', state: 'exited', statusText: 'Exited (0) 2 hours ago' }),
  svc({ name: 'stopped', state: 'exited', statusText: 'Exited (143) 1 day ago' }),
  svc({ name: 'crashed', state: 'exited', statusText: 'Exited (2) 5 minutes ago' }),
  svc({ name: 'killed', state: 'exited', statusText: 'Exited (137) 1 hour ago' }),
]

function fleet(over: Partial<FleetSource> = {}): FleetSource {
  const isProxy = (s: Service) => s.image.startsWith('jc21/')
  const exposure = async ({ id }: { probe: boolean; id?: string }) => {
    const running = SERVICES.filter((s) => s.state === 'running' && (!id || s.id === id))
    const list = sortExposure(running.map((s) => exposureOf(exposureInput(s, isProxy(s)))))
    return { services: list, summary: exposureSummary(list), probed: false, pingEnabled: true }
  }
  return {
    services: async () => ({ services: SERVICES, unmatched: [{ domains: ['old.example.com'], upstream: '10.0.0.5:9000', ssl: true }], stats: { running: 5, total: 8, groups: 1 }, domainProvider: 'Nginx Proxy Manager', controlEnabled: false, remoteIcons: false, hosts: [{ id: 'h1', name: 'h1', online: true }], generatedAt: 0 }),
    stats: async () => ({ 'h1::jellyfin-id': { cpuPercent: 3.5, memBytes: 300 * 1024 ** 2, memLimitBytes: 0, memPercent: null } }),
    updates: async () => ({
      enabled: true,
      entries: {
        'h1|jellyfin:1.0': { status: 'current', checkedAt: 1000, newer: { tag: '1.1', bump: 'minor' } },
        'h1|db:1.0': { status: 'current', checkedAt: 1000 },
        'h1|postgres:16': { status: 'update', checkedAt: 1000 },
        'h1|wiki:1.0': { status: 'error', checkedAt: 1000, error: 'registry said 401' },
      },
    }),
    exposure,
    alerts: async (n) => [{ id: 'h1::db-id', name: 'db', kind: 'unhealthy', from: 'healthy', to: 'unhealthy', at: 5000 }].slice(0, n),
    logs: async (_id, tail) => Array.from({ length: tail }, (_, i): LogLineLike => ({ s: i % 10 === 0 ? 'stderr' : 'stdout', t: `2026-11-25T10:00:${String(i % 60).padStart(2, '0')}.123456Z`, line: i % 10 === 0 ? `ERROR number ${i}` : `ok ${i}` })),
    alertsEnabled: true,
    now: 10_000,
    ...over,
  }
}

const SERVER: McpServer<FleetSource> = { name: 'homeport', title: 'homeport', version: '9.9.9', instructions: SERVER_INSTRUCTIONS, tools: fleetTools }

// ---------- the two client eras ----------

/** A legacy (initialize-era) request: version in the header only, after initialize. */
function legacy(body: unknown, headers: Record<string, string> = { 'mcp-protocol-version': '2025-06-18' }, src = fleet()) {
  return handleMcpPost(JSON.stringify(body), (n) => headers[n], SERVER, src)
}

/** A modern (2026-07-28) request: version and capabilities in _meta, mirrored in headers. */
function modern(method: string, params: Record<string, unknown> = {}, headerOver: Record<string, string | undefined> = {}, src = fleet()) {
  const body = { jsonrpc: '2.0', id: 7, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } }
  const headers: Record<string, string | undefined> = { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}), ...headerOver }
  return handleMcpPost(JSON.stringify(body), (n) => headers[n], SERVER, src)
}

const err = (r: { body?: any }) => r.body?.error
const text = (r: { body?: any }) => r.body?.result?.content?.[0]?.text as string

// ---------- JSON-RPC framing ----------

test('framing: unparseable body, batch, non-2.0 and responses are 400 with standard codes', async () => {
  const parse = await handleMcpPost('{nope', () => undefined, SERVER, fleet())
  assert.equal(parse.status, 400)
  assert.equal(err(parse).code, RPC.PARSE_ERROR)
  assert.equal('id' in (parse.body as any), false) // no id could be read
  const batch = await handleMcpPost('[{"jsonrpc":"2.0","id":1,"method":"ping"}]', () => undefined, SERVER, fleet())
  assert.equal(batch.status, 400)
  assert.equal(err(batch).code, RPC.INVALID_REQUEST)
  assert.equal(err(await legacy({ jsonrpc: '1.0', id: 1, method: 'ping' })).code, RPC.INVALID_REQUEST)
  // this server sends no requests, so a client "response" is not something it takes
  const resp = await legacy({ jsonrpc: '2.0', id: 1, result: {} })
  assert.equal(resp.status, 400)
  assert.equal(err(resp).code, RPC.INVALID_REQUEST)
  assert.equal(err(await legacy({ jsonrpc: '2.0', id: null, method: 'ping' })).code, RPC.INVALID_REQUEST)
  assert.equal(err(await legacy({ jsonrpc: '2.0', id: 1, method: 'ping', params: [1] })).code, RPC.INVALID_REQUEST)
})

test('framing: a notification is accepted with 202 and no body', async () => {
  const r = await legacy({ jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(r.status, 202)
  assert.equal(r.body, undefined)
})

test('framing: an over-sized body is refused before parsing', async () => {
  const r = await handleMcpPost(`{"jsonrpc":"2.0","id":1,"method":"ping","pad":"${'x'.repeat(70_000)}"}`, () => undefined, SERVER, fleet())
  assert.equal(r.status, 413)
})

// ---------- legacy era (initialize handshake) ----------

test('legacy: initialize echoes a supported version, else offers the newest legacy one', async () => {
  const r = await legacy({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, {})
  assert.equal(r.status, 200)
  const res = (r.body as any).result
  assert.equal(res.protocolVersion, '2025-06-18')
  assert.deepEqual(res.capabilities, { tools: { listChanged: false } })
  assert.equal(res.serverInfo.name, 'homeport')
  assert.equal(res.serverInfo.version, '9.9.9')
  assert.ok(res.instructions.includes('find_domain'))
  assert.equal('resultType' in res, false) // a modern-only field stays out of legacy answers
  const odd = await legacy({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, {})
  assert.equal((odd.body as any).result.protocolVersion, '2025-11-25')
  const bad = await legacy({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }, {})
  assert.equal(err(bad).code, RPC.INVALID_PARAMS)
})

test('legacy: ping, unknown method (200, so the client does not fall back to old SSE), version header rules', async () => {
  assert.deepEqual((await legacy({ jsonrpc: '2.0', id: 'a', method: 'ping' })).body, { jsonrpc: '2.0', id: 'a', result: {} })
  // no header at all: the spec lets the server assume 2025-03-26
  assert.equal((await legacy({ jsonrpc: '2.0', id: 1, method: 'ping' }, {})).status, 200)
  const unknown = await legacy({ jsonrpc: '2.0', id: 4, method: 'resources/list' })
  assert.equal(unknown.status, 200)
  assert.equal(err(unknown).code, RPC.METHOD_NOT_FOUND)
  assert.equal(err(unknown).message.includes('resources/list'), true)
  assert.equal((unknown.body as any).id, 4)
  const old = await legacy({ jsonrpc: '2.0', id: 5, method: 'ping' }, { 'mcp-protocol-version': '2024-11-05' })
  assert.equal(old.status, 400)
  assert.equal(err(old).code, RPC.UNSUPPORTED_VERSION)
  assert.deepEqual(err(old).data.supported, SUPPORTED_VERSIONS)
  // a modern header without the modern body is a mismatch, not a silent downgrade
  const half = await legacy({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { 'mcp-protocol-version': '2026-07-28' })
  assert.equal(half.status, 400)
  assert.equal(err(half).code, RPC.HEADER_MISMATCH)
})

// ---------- modern era (2026-07-28, per-request _meta) ----------

test('modern: server/discover advertises versions, tools, identity and a private cache hint', async () => {
  const r = await modern('server/discover')
  assert.equal(r.status, 200)
  const res = (r.body as any).result
  assert.equal(res.resultType, 'complete')
  assert.deepEqual(res.supportedVersions, SUPPORTED_VERSIONS)
  assert.ok(res.capabilities.tools)
  assert.equal(res._meta['io.modelcontextprotocol/serverInfo'].name, 'homeport')
  assert.equal(res.cacheScope, 'private') // behind a token: shared caches must not keep it
  assert.ok(res.ttlMs > 0)
})

test('modern: headers must match the body (HeaderMismatch -32020, HTTP 400)', async () => {
  for (const over of [{ 'mcp-protocol-version': undefined }, { 'mcp-protocol-version': '2025-11-25' }, { 'mcp-method': undefined }, { 'mcp-method': 'tools/call' }]) {
    const r = await modern('tools/list', {}, over)
    assert.equal(r.status, 400, JSON.stringify(over))
    assert.equal(err(r).code, RPC.HEADER_MISMATCH, JSON.stringify(over))
    assert.equal((r.body as any).id, 7)
  }
  const name = await modern('tools/call', { name: 'list_services', arguments: {} }, { 'mcp-name': 'get_logs' })
  assert.equal(err(name).code, RPC.HEADER_MISMATCH)
  const noName = await modern('tools/call', { name: 'list_services', arguments: {} }, { 'mcp-name': undefined })
  assert.equal(err(noName).code, RPC.HEADER_MISMATCH)
  // the base64 sentinel form decodes before comparing
  const b64 = await modern('tools/call', { name: 'list_services', arguments: {} }, { 'mcp-name': `=?base64?${Buffer.from('list_services').toString('base64')}?=` })
  assert.equal(b64.status, 200)
})

test('modern: unsupported version (-32022 with the supported list), missing capabilities (-32602), unknown method (404)', async () => {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2030-01-01', 'io.modelcontextprotocol/clientCapabilities': {} } } }
  const v = await handleMcpPost(JSON.stringify(body), (n) => ({ 'mcp-protocol-version': '2030-01-01', 'mcp-method': 'tools/list' } as Record<string, string>)[n], SERVER, fleet())
  assert.equal(v.status, 400)
  assert.equal(err(v).code, RPC.UNSUPPORTED_VERSION)
  assert.equal(err(v).data.requested, '2030-01-01')
  assert.ok(err(v).data.supported.includes('2026-07-28'))

  const noCaps = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }
  const c = await handleMcpPost(JSON.stringify(noCaps), (n) => ({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' } as Record<string, string>)[n], SERVER, fleet())
  assert.equal(c.status, 400)
  assert.equal(err(c).code, RPC.INVALID_PARAMS)

  for (const m of ['initialize', 'ping', 'subscriptions/listen', 'resources/list']) {
    const r = await modern(m)
    assert.equal(r.status, 404, m)
    assert.equal(err(r).code, RPC.METHOD_NOT_FOUND, m)
  }
})

// ---------- tools/list and tools/call ----------

test('tools/list: the seven read-only tools, in a fixed order, each with a usable schema', async () => {
  const r = await legacy({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  const tools = (r.body as any).result.tools
  // The read-token exception for POST /api/mcp rests on this list being read-only.
  // A new tool here is a security decision: check it only reads what GET already serves.
  assert.deepEqual(tools.map((t: any) => t.name), ['list_services', 'get_service', 'find_domain', 'list_updates', 'exposure_report', 'recent_alerts', 'get_logs'])
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object', t.name)
    assert.equal(t.inputSchema.additionalProperties, false, t.name)
    assert.ok(t.description.length > 40, t.name)
    assert.ok(t.title, t.name)
    assert.equal(t.annotations.readOnlyHint, true, t.name)
    assert.equal(t.annotations.destructiveHint, false, t.name)
    assert.equal('run' in t, false) // the function never leaks into the JSON
    for (const req of t.inputSchema.required ?? []) assert.ok(req in t.inputSchema.properties, `${t.name}.${req}`)
  }
  // modern answers add the cache hint
  const m = (await modern('tools/list')).body as any
  assert.equal(m.result.resultType, 'complete')
  assert.equal(m.result.tools.length, 7)
  assert.equal(m.result.cacheScope, 'private')
})

test('tools/list: get_logs is not offered while the logs capability is off', async () => {
  const r = await legacy({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined, fleet({ logs: null }))
  const names = (r.body as any).result.tools.map((t: any) => t.name)
  assert.equal(names.includes('get_logs'), false)
  assert.equal(names.length, 6)
  // and calling it anyway is an unknown tool, not a back door
  const c = await legacy({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_logs', arguments: { service: 'jellyfin' } } }, undefined, fleet({ logs: null }))
  assert.equal(err(c).code, RPC.INVALID_PARAMS)
})

test('tools/call: bad params are protocol errors, bad arguments are tool errors the model can fix', async () => {
  const noName = await legacy({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} })
  assert.equal(err(noName).code, RPC.INVALID_PARAMS)
  const unknown = await legacy({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'restart_container', arguments: {} } })
  assert.equal(err(unknown).code, RPC.INVALID_PARAMS)
  assert.ok(err(unknown).message.includes('restart_container'))
  const argsNotObj = await legacy({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_services', arguments: 'all' } })
  assert.equal(err(argsNotObj).code, RPC.INVALID_PARAMS)

  const typo = await legacy({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_services', arguments: { stauts: 'problem' } } })
  assert.equal(typo.status, 200)
  assert.equal((typo.body as any).result.isError, true)
  assert.ok(text(typo).includes('stauts') && text(typo).includes('status'))
  const range = await legacy({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_logs', arguments: { service: 'jellyfin', lines: 100000 } } })
  assert.equal((range.body as any).result.isError, true)
  const missing = await legacy({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'find_domain', arguments: {} } })
  assert.ok(text(missing).includes('domain'))
})

test('tools/call: a failing data source is a tool error, not a crashed request', async () => {
  const broken = fleet({ services: async () => { throw new Error('connect ENOENT /var/run/docker.sock') } })
  const r = await legacy({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_services', arguments: {} } }, undefined, broken)
  assert.equal(r.status, 200)
  assert.equal((r.body as any).result.isError, true)
  assert.ok(text(r).includes('docker.sock'))
})

test('find_domain: names the container, the proxy and how it is reached; wildcards and URLs work', async () => {
  const r = await modern('tools/call', { name: 'find_domain', arguments: { domain: 'https://Media.Example.com/web/index.html' } })
  assert.equal(r.status, 200)
  const t = text(r)
  assert.ok(t.includes('"jellyfin"'), t)
  assert.ok(t.includes('Nginx Proxy Manager') && t.includes('container npm'), t)
  assert.ok(t.includes('by container name') && t.includes('port 8096'), t)
  // jellyfin's 8096 is published on every interface: the finding travels with the answer
  assert.ok(t.includes('Reachable around the proxy'), t)
  const wild = text(await modern('tools/call', { name: 'find_domain', arguments: { domain: 'team.wiki.example.com' } }))
  assert.ok(wild.includes('"wiki"') && wild.includes('wildcard'), wild)
  const stale = text(await modern('tools/call', { name: 'find_domain', arguments: { domain: 'old.example.com' } }))
  assert.ok(stale.includes('10.0.0.5:9000') && stale.includes('no container'), stale)
  const none = text(await modern('tools/call', { name: 'find_domain', arguments: { domain: 'nothing.invalid' } }))
  assert.ok(none.startsWith('No reverse proxy route'), none)
})

test('list_services: status "problem" is unhealthy, restarting and real crashes, not clean stops', async () => {
  const r = await legacy({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_services', arguments: { status: 'problem' } } })
  const t = text(r)
  const listed = [...t.matchAll(/^- (\S+)/gm)].map((m) => m[1])
  assert.deepEqual(listed.sort(), ['crashed', 'db', 'worker'])
  const all = text(await legacy({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_services', arguments: {} } }))
  assert.ok(all.includes('cpu=3.5%') && all.includes('id=h1::jellyfin-id'), all)
  assert.ok(all.includes('0.0.0.0:8096->8096/tcp (every interface)'), all)
  assert.ok(all.includes('1 proxy route(s) point at no container'), all)
  // a SIGKILL exit is explained in the state, though it is not a "problem"
  assert.ok(/^- killed \[exited, killed \(exit 137/m.test(all), all)
})

test('list_updates: names what needs updating and why; says so when checks are off', async () => {
  const t = text(await legacy({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_updates', arguments: {} } }))
  assert.ok(/jellyfin.*newer version 1\.1 \(minor\)/.test(t), t)
  assert.ok(/db.*new image was published/.test(t), t)
  assert.ok(t.includes('check failed: 1 (wiki (registry said 401))'), t)
  const off = text(await legacy({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_updates', arguments: {} } }, undefined, fleet({ updates: async () => ({ enabled: false, entries: {} }) })))
  assert.ok(off.startsWith('Update checks are off'), off)
})

test('get_logs: capped, filtered, stderr marked, long lines cut', async () => {
  let asked = 0
  const src = fleet({
    logs: async (_id, tail) => {
      asked = tail
      return [{ s: 'stderr', t: '2026-11-25T10:00:00.5Z', line: `boom ${'x'.repeat(2000)}` }, { s: 'stdout', t: '', line: 'fine' }]
    },
  })
  const t = text(await legacy({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_logs', arguments: { service: 'jellyfin', lines: 5 } } }, undefined, src))
  assert.equal(asked, 5)
  assert.ok(t.includes('2026-11-25T10:00:00Z ! boom'), t)
  assert.ok(t.includes('[...]') && t.length < 1000, `${t.length}`)
  const f = text(await legacy({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_logs', arguments: { service: 'jellyfin', contains: 'error', lines: 3 } } }))
  const shown = f.split('\n').slice(1)
  assert.equal(shown.length, 3)
  assert.ok(shown.every((l) => l.includes('ERROR')), f)
  const big = await legacy({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_logs', arguments: { service: 'jellyfin', lines: MAX_LOG_LINES + 1 } } })
  assert.equal((big.body as any).result.isError, true)
  const sys = await legacy({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_logs', arguments: { service: 'nobody' } } })
  assert.equal((sys.body as any).result.isError, true)
})

test('recent_alerts and exposure_report answer from the source', async () => {
  const a = text(await legacy({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recent_alerts', arguments: { service: 'db' } } }))
  assert.ok(a.includes('unhealthy: db') && a.includes('healthy -> unhealthy'), a)
  const quiet = text(await legacy({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'recent_alerts', arguments: {} } }, undefined, fleet({ alerts: async () => [], alertsEnabled: false })))
  assert.ok(quiet.includes('Alerting is off'), quiet)
  const e = text(await legacy({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'exposure_report', arguments: {} } }))
  assert.ok(e.includes('jellyfin') && e.includes('[risk]') && e.includes('"8096:8096" -> "127.0.0.1:8096:8096"'), e)
})

// ---------- helpers ----------

test('normDomain and domainMatches: what people paste reduces to the routed host', () => {
  assert.equal(normDomain(' HTTPS://user@App.Example.com:8443/x?y#z '), 'app.example.com')
  assert.equal(normDomain('app.example.com.'), 'app.example.com')
  assert.equal(domainMatches('*.example.com', 'a.example.com'), true)
  assert.equal(domainMatches('*.example.com', 'a.b.example.com'), false) // one label only
  assert.equal(domainMatches('*.example.com', 'example.com'), false)
  assert.equal(domainMatches('App.Example.com', 'app.example.com'), true)
})

test('problemOf: crashes count, clean stops do not, SIGKILL is named', () => {
  const s = (state: string, statusText: string, health: Service['health'] = null) => svc({ name: 'x', state, statusText, health })
  assert.equal(problemOf(s('exited', 'Exited (0) 1 hour ago')), null)
  assert.equal(problemOf(s('exited', 'Exited (143) 1 hour ago')), null)
  assert.equal(problemOf(s('exited', 'Exited (1) 1 hour ago')), 'exited with code 1')
  // SIGKILL is also how `docker stop` ends an app that ignores SIGTERM: not a problem by itself
  assert.equal(problemOf(s('exited', 'Exited (137) 1 hour ago')), null)
  assert.equal(problemOf(s('running', 'Up', 'unhealthy')), 'unhealthy')
  assert.equal(problemOf(s('running', 'Up', 'starting')), null)
  assert.equal(problemOf(s('failed', 'failed')), 'failed')
})

test('resolveService: id, name, domain, unique partial; ambiguity lists ids', () => {
  const list = [...SERVICES, svc({ name: 'jellyfin', id: 'h2::jf', host: 'h2' })]
  assert.equal((resolveService(list, 'h2::jf') as any).service.id, 'h2::jf')
  const amb = resolveService(list, 'JellyFin')
  assert.ok('error' in amb && amb.error.includes('h1::jellyfin-id') && amb.error.includes('h2::jf'))
  assert.equal((resolveService(SERVICES, 'https://media.example.com') as any).service.name, 'jellyfin')
  assert.equal((resolveService(SERVICES, 'crash') as any).service.name, 'crashed')
  assert.ok('error' in resolveService(SERVICES, 'zzz'))
  assert.ok('error' in resolveService(SERVICES, '   '))
})

test('validateArgs, capText and the base64 header sentinel', () => {
  const schema = { type: 'object' as const, properties: { n: { type: 'integer' as const, description: '', minimum: 1, maximum: 5 }, s: { type: 'string' as const, description: '', enum: ['a', 'b'] }, b: { type: 'boolean' as const, description: '' } }, required: ['n'], additionalProperties: false as const }
  assert.equal(validateArgs(schema, { n: 3, s: 'a', b: true }), null)
  assert.ok(validateArgs(schema, {})!.includes('Missing'))
  assert.ok(validateArgs(schema, { n: 1.5 })!.includes('whole'))
  assert.ok(validateArgs(schema, { n: 9 })!.includes('at most 5'))
  assert.ok(validateArgs(schema, { n: 1, s: 'c' })!.includes('one of'))
  assert.ok(validateArgs(schema, { n: 1, b: 'yes' })!.includes('true or false'))
  assert.ok(validateArgs(schema, { n: 1, x: 1 })!.includes('Unknown argument'))
  const long = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')
  const cut = capText(long)
  assert.ok(cut.length <= MAX_TOOL_TEXT + 200)
  assert.ok(cut.endsWith('to see the rest]'))
  assert.equal(capText('short'), 'short')
  assert.equal(decodeHeaderValue('=?base64?aMOpbGxv?='), 'héllo')
  assert.equal(decodeHeaderValue(' plain '), 'plain')
  assert.equal(decodeHeaderValue(undefined), null)
})
