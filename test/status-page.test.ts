import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPublicStatus,
  sanitizeStatusPageConfig,
  sanitizeNotice,
  cleanLine,
  statusOverall,
  containerStatusState,
  domainStatusState,
  normalizeTzOffset,
  publicRatio,
  statusContainerKey,
  statusDomainKey,
  STATUS_PAGE_LIMITS,
  DEMO_STATUS_PAGE,
  statusDayTone,
  type StatusPageConfig,
  type StatusSource,
} from '../shared/utils/status-page.ts'
import { createStore, recordSample, uptimeFor, uptimeDays, dayEdges } from '../server/utils/history-core.ts'
import { formatUptime } from '../utils/uptime.ts'
import { scopeAllows } from '../server/utils/api-tokens-core.ts'

// A fleet whose records carry everything a status page must never publish.
const SECRETS = ['c0ffee1234567890', 'registry.internal:5000/team/app:1.2.3', '10.0.0.7', '8443', 'https://jellyfin.internal.lan:8096', 'ECONNREFUSED', 'nas-01', 'hp_tokenvalue']
const fleet: Record<string, any> = {
  'default|jellyfin': { id: 'nas-01::c0ffee1234567890', name: 'jellyfin', image: 'registry.internal:5000/team/app:1.2.3', state: 'running', health: 'healthy', ports: [{ hostPort: 8443 }], statusText: 'Up 3 days', ip: '10.0.0.7' },
  'default|internal-db': { id: 'default::deadbeef', name: 'internal-db', image: 'postgres:16', state: 'running', health: null },
}
const source = (over: Partial<StatusSource> = {}): StatusSource => ({
  now: 1_700_000_000_000,
  container: (key) => fleet[key] ?? null,
  domain: (d) => (d === 'blog.example.com' ? ({ status: 200, ms: 12, url: 'https://jellyfin.internal.lan:8096', error: 'ECONNREFUSED' } as any) : null),
  uptime: () => ({ windows: { '24h': 1, '7d': 0.99991, '30d': 0.999999 }, days: [{ from: 1, ratio: 1, n: 99, token: 'hp_tokenvalue' } as any] }),
  ...over,
})
const page = (groups: StatusPageConfig['groups'], extra: Partial<StatusPageConfig> = {}): StatusPageConfig => ({ title: 'Status', notice: '', noticeKind: 'info', groups, ...extra })

test('the public answer holds only the picked items and only the listed fields', () => {
  const out = buildPublicStatus(page([{ name: 'Media', items: [{ kind: 'container', ref: 'default|jellyfin', name: 'Movies' }, { kind: 'domain', ref: 'blog.example.com', name: 'Blog' }] }]), source())
  const json = JSON.stringify(out)
  for (const s of SECRETS) assert.ok(!json.includes(s), `leaked ${s}`)
  assert.ok(!json.includes('internal-db'), 'an unpicked container must not appear')
  assert.deepEqual(Object.keys(out).sort(), ['groups', 'notice', 'noticeKind', 'overall', 'title', 'updatedAt'])
  const [movies, blog] = out.groups[0].items
  assert.deepEqual(Object.keys(movies).sort(), ['days', 'name', 'state', 'uptime'])
  assert.deepEqual(Object.keys(blog).sort(), ['days', 'domain', 'name', 'state', 'uptime'])
  assert.equal(blog.domain, 'blog.example.com') // a picked domain publishes its name, nothing else about it
  assert.deepEqual(Object.keys(movies.days[0]).sort(), ['from', 'ratio'])
})

test('fail closed: nothing picked shows nothing, and unknown kinds or refs are dropped', () => {
  assert.deepEqual(buildPublicStatus(page([{ name: '', items: [] }]), source()).groups, [])
  const cfg = sanitizeStatusPageConfig({
    groups: [{
      name: 'x',
      items: [
        { kind: 'container', ref: 'default|jellyfin', name: 'ok' },
        { kind: 'host', ref: 'default', name: 'a host' },
        { kind: 'container', ref: 'no-pipe', name: 'bad key' },
        { kind: 'domain', ref: 'https://evil.example.com/path', name: 'a URL, not a name' },
        { kind: 'domain', ref: '*.example.com', name: 'wildcard' },
        { kind: 'domain', ref: 'a b.example.com', name: 'space' },
        { kind: 'container', ref: 'default|jellyfin', name: 'duplicate' },
      ],
    }],
  })
  assert.deepEqual(cfg.groups[0].items.map((i) => i.name), ['ok'])
  // a hand-edited file that skips the sanitiser still can't publish a malformed ref
  const raw = page([{ name: '', items: [{ kind: 'domain', ref: 'http://10.0.0.7:8443/admin', name: 'x' }] }])
  assert.deepEqual(buildPublicStatus(raw, source()).groups, [])
})

test('garbage in leaves less on the page, never more', () => {
  for (const raw of [null, undefined, 42, 'groups', [], { groups: 'all' }, { groups: [null, 7, { items: 'x' }] }]) {
    const cfg = sanitizeStatusPageConfig(raw)
    assert.equal(cfg.groups.flatMap((g) => g.items).length, 0)
    assert.equal(cfg.title, 'Status')
  }
})

test('limits: 50 items, 20 groups, names and titles capped', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ kind: 'container', ref: `default|app${i}`, name: 'n'.repeat(200) }))
  const cfg = sanitizeStatusPageConfig({ title: 't'.repeat(300), groups: [{ name: 'g'.repeat(100), items: many }, ...Array.from({ length: 30 }, () => ({ name: 'x', items: [] }))] })
  assert.equal(cfg.groups.flatMap((g) => g.items).length, STATUS_PAGE_LIMITS.items)
  assert.equal(cfg.groups.length, STATUS_PAGE_LIMITS.groups)
  assert.equal(cfg.title.length, STATUS_PAGE_LIMITS.title)
  assert.equal(cfg.groups[0].name.length, STATUS_PAGE_LIMITS.group)
  assert.equal(cfg.groups[0].items[0].name.length, STATUS_PAGE_LIMITS.name)
})

test('an empty name falls back to the container name or the domain, never to the full key', () => {
  const cfg = sanitizeStatusPageConfig({ groups: [{ name: '', items: [{ kind: 'container', ref: 'nas-01|jellyfin', name: '   ' }, { kind: 'domain', ref: 'Blog.Example.com', name: '' }] }] })
  assert.deepEqual(cfg.groups[0].items.map((i) => [i.ref, i.name]), [['nas-01|jellyfin', 'jellyfin'], ['blog.example.com', 'blog.example.com']])
})

test('notice: plain text kept as written, line breaks kept, invisible characters dropped, capped', () => {
  assert.equal(sanitizeNotice('<b>Down</b> & <script>alert(1)</script>'), '<b>Down</b> & <script>alert(1)</script>') // rendered as text, so kept literally
  assert.equal(sanitizeNotice('one\r\ntwo\n\n\n\nthree  \n'), 'one\ntwo\n\nthree')
  assert.equal(sanitizeNotice('evil‮moc.elpmaxe​\u0007'), 'evilmoc.elpmaxe') // bidi override, zero-width, bell
  assert.equal(sanitizeNotice(42), '')
  const long = sanitizeNotice('é'.repeat(600))
  assert.equal(Array.from(long).length, STATUS_PAGE_LIMITS.notice)
  // never half a surrogate pair at the cut
  const emoji = sanitizeNotice('🙂'.repeat(600))
  assert.equal(Array.from(emoji).length, STATUS_PAGE_LIMITS.notice)
  assert.ok(!/[\uD800-\uDBFF]$/.test(emoji))
})

test('names are one line', () => {
  assert.equal(cleanLine('  Movies\n\tand   TV ', 60), 'Movies and TV')
  assert.equal(cleanLine({ toString: () => 'x' }, 60), '')
})

test('container and domain states', () => {
  assert.equal(containerStatusState({ state: 'running', health: null }), 'operational')
  assert.equal(containerStatusState({ state: 'running', health: 'starting' }), 'operational')
  assert.equal(containerStatusState({ state: 'running', health: 'unhealthy' }), 'degraded')
  assert.equal(containerStatusState({ state: 'restarting', health: null }), 'down')
  assert.equal(containerStatusState({ state: 'exited', health: null }), 'down')
  assert.equal(containerStatusState(null), 'unknown')
  assert.equal(containerStatusState({ state: 'running' }, false), 'unknown') // host unreachable
  assert.equal(domainStatusState({ status: 200 }), 'operational')
  assert.equal(domainStatusState({ status: 401 }), 'operational') // the app answered with its login
  assert.equal(domainStatusState({ status: 502 }), 'down')
  assert.equal(domainStatusState({ status: 0 }), 'down')
  assert.equal(domainStatusState(null), 'unknown')
})

test('a container on an unreachable host reads unknown, not down', () => {
  const out = buildPublicStatus(page([{ name: '', items: [{ kind: 'container', ref: 'default|jellyfin', name: 'J' }] }]), source({ container: () => 'offline' }))
  assert.equal(out.groups[0].items[0].state, 'unknown')
})

test('rollup: the headline never reads better than the items', () => {
  assert.equal(statusOverall(['operational', 'operational']), 'operational')
  assert.equal(statusOverall(['operational', 'degraded']), 'issues')
  assert.equal(statusOverall(['operational', 'down']), 'issues')
  assert.equal(statusOverall(['down', 'down']), 'outage')
  assert.equal(statusOverall(['down', 'unknown']), 'issues') // not "all down": one isn't known
  assert.equal(statusOverall(['operational', 'unknown']), 'not-reporting') // never "all operational"
  assert.equal(statusOverall(['unknown']), 'unknown')
  assert.equal(statusOverall([]), 'unknown')
})

test('ratios never round up to a clean 100%', () => {
  assert.equal(publicRatio(0.999999), 0.99999)
  assert.equal(publicRatio(1), 1)
  assert.equal(publicRatio(null), null)
  assert.equal(publicRatio(NaN), null)
  const out = buildPublicStatus(page([{ name: '', items: [{ kind: 'container', ref: 'default|jellyfin', name: 'J' }] }]), source())
  assert.equal(out.groups[0].items[0].uptime['30d'], 0.99999)
})

test('history off: uptime is null, not zero', () => {
  const out = buildPublicStatus(page([{ name: '', items: [{ kind: 'container', ref: 'default|jellyfin', name: 'J' }] }]), source({ uptime: () => null }))
  assert.deepEqual(out.groups[0].items[0].uptime, { '24h': null, '7d': null, '30d': null })
  assert.deepEqual(out.groups[0].items[0].days, [])
})

test('groups keep the admin order and empty groups are left out', () => {
  const out = buildPublicStatus(page([
    { name: 'Later', items: [{ kind: 'container', ref: 'default|jellyfin', name: 'B' }] },
    { name: 'Empty', items: [] },
    { name: '', items: [{ kind: 'domain', ref: 'blog.example.com', name: 'A' }] },
  ]), source())
  assert.deepEqual(out.groups.map((g) => g.name), ['Later', ''])
})

test('time zone offsets are whole quarter hours within real zones (bounds the cache)', () => {
  assert.equal(normalizeTzOffset('-60'), -60)
  assert.equal(normalizeTzOffset(-330), -330) // India
  assert.equal(normalizeTzOffset(-344), -345) // rounded to a quarter hour
  assert.equal(normalizeTzOffset(10_000), 0)
  assert.equal(normalizeTzOffset('abc'), 0)
  assert.equal(normalizeTzOffset(undefined), 0)
  assert.equal(Object.is(normalizeTzOffset(-1), 0), true) // never -0 as a cache key
  const keys = new Set(Array.from({ length: 4000 }, (_, i) => normalizeTzOffset(i - 2000)))
  assert.ok(keys.size <= 113)
})

test('keys: container keys match history.ts, domain keys can never collide with them', () => {
  assert.equal(statusContainerKey('nas::abc', 'jellyfin'), 'nas|jellyfin')
  assert.equal(statusContainerKey('abc', 'jellyfin'), 'default|jellyfin')
  assert.ok(!statusDomainKey('x.example.com').includes('|'))
})

test('the demo page is valid as it stands', () => {
  assert.deepEqual(sanitizeStatusPageConfig(DEMO_STATUS_PAGE), DEMO_STATUS_PAGE)
})

test('down or degraded right now: today\'s bar never looks clean', () => {
  // one down sample late in a long day still rounds to a clean day on its own
  assert.equal(statusDayTone(0.9997, true, 'operational'), 'ok')
  assert.equal(statusDayTone(0.9997, true, 'down'), 'warn')
  assert.equal(statusDayTone(1, true, 'down'), 'warn')
  assert.equal(statusDayTone(1, true, 'degraded'), 'warn')
  assert.equal(statusDayTone(null, true, 'down'), 'warn') // picked today, down since: still today's news
  assert.equal(statusDayTone(0.5, true, 'down'), 'bad') // already worse: stays worse
  assert.equal(statusDayTone(1, false, 'down'), 'ok') // past days are as recorded
  assert.equal(statusDayTone(null, true, 'unknown'), 'none')
})

test('no samples is "no data", never 100%: a container gone three days ago', () => {
  const DAY = 86_400_000
  const now = Date.UTC(2026, 10, 20, 12)
  const store = createStore(60, 1440)
  // up every 30 s for a week, until three days ago
  for (let t = now - 10 * DAY; t < now - 3 * DAY; t += 30_000) recordSample(store, t, { up: true })
  const windows = { '24h': uptimeFor(store, DAY, now, 30_000).ratio, '7d': uptimeFor(store, 7 * DAY, now, 30_000).ratio, '30d': uptimeFor(store, 30 * DAY, now, 30_000).ratio }
  const days = uptimeDays(store, dayEdges(now, 30, 0), 30_000).map((d) => ({ from: d.from, ratio: d.ratio }))
  const out = buildPublicStatus(page([{ name: '', items: [{ kind: 'container', ref: 'default|old-wiki', name: 'Old wiki' }] }]), source({ container: () => null, uptime: () => ({ windows, days }) }))
  const it = out.groups[0].items[0]
  assert.equal(it.state, 'unknown')
  assert.equal(it.uptime['24h'], null)
  assert.equal(formatUptime(it.uptime['24h']), 'No data')
  assert.equal(it.uptime['7d'], 1) // what was seen while it ran is still true
  assert.deepEqual(it.days.slice(-3).map((d) => d.ratio), [null, null, null])
  assert.equal(statusDayTone(it.days.at(-1)!.ratio, true, it.state), 'none') // grey, not green
  assert.equal(out.overall, 'unknown')
})

test('the preview is admin-only: read tokens and viewer accounts get no draft page', () => {
  assert.equal(scopeAllows('read', 'GET', '/api/status-page/preview'), false)
  assert.equal(scopeAllows('full', 'GET', '/api/status-page/preview'), true)
})
