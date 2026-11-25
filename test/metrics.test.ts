import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatPrometheus, escapeLabelValue, escapeHelp, formatValue, buildMetrics, type MetricsInput } from '../server/utils/metrics-core.ts'

test('label values escape backslash, double quote and newline', () => {
  assert.equal(escapeLabelValue('a\\b"c\nd'), 'a\\\\b\\"c\\nd')
  // the backslash is escaped first, so an escaped quote is not escaped twice
  assert.equal(escapeLabelValue('\\"'), '\\\\\\"')
  assert.equal(escapeLabelValue('plain-name_1.2'), 'plain-name_1.2')
})

test('HELP escapes backslash and newline but keeps quotes', () => {
  assert.equal(escapeHelp('say "hi"\\now\nnext'), 'say "hi"\\\\now\\nnext')
})

test('special values use the exposition spellings', () => {
  assert.equal(formatValue(NaN), 'NaN')
  assert.equal(formatValue(Infinity), '+Inf')
  assert.equal(formatValue(-Infinity), '-Inf')
  assert.equal(formatValue(0.125), '0.125')
  assert.equal(formatValue(1234567890), '1234567890')
})

test('each family gets one HELP and one TYPE line, before its samples', () => {
  const text = formatPrometheus([
    { name: 'x_up', help: 'Up.', type: 'gauge', samples: [{ labels: { name: 'a' }, value: 1 }, { labels: { name: 'b' }, value: 0 }] },
    { name: 'x_total', help: 'Count.', type: 'counter', samples: [{ value: 3 }] },
  ])
  assert.equal(
    text,
    '# HELP x_up Up.\n# TYPE x_up gauge\nx_up{name="a"} 1\nx_up{name="b"} 0\n# HELP x_total Count.\n# TYPE x_total counter\nx_total 3\n',
  )
})

test('a family without samples prints nothing; empty label values are dropped', () => {
  const text = formatPrometheus([
    { name: 'empty_family', help: 'x', type: 'gauge', samples: [] },
    { name: 'x', help: 'x', type: 'gauge', samples: [{ labels: { name: 'a', project: '', host: null }, value: 1 }] },
  ])
  assert.ok(!text.includes('empty_family'))
  assert.ok(text.includes('x{name="a"} 1'))
})

test('a hostile container or domain name cannot break out of its label', () => {
  const text = formatPrometheus([{ name: 'x', help: 'x', type: 'gauge', samples: [{ labels: { name: 'evil"} 1\nfake_metric{a="' }, value: 1 }] }])
  const lines = text.trim().split('\n')
  assert.equal(lines.length, 3) // HELP, TYPE, one sample: no injected line
  assert.ok(!lines.some((l) => l.startsWith('fake_metric')))
})

test('invalid metric and label names are refused (a bug here, never user data)', () => {
  assert.throws(() => formatPrometheus([{ name: 'bad-name', help: '', type: 'gauge', samples: [{ value: 1 }] }]))
  assert.throws(() => formatPrometheus([{ name: 'ok', help: '', type: 'gauge', samples: [{ labels: { 'bad-label': 'x' }, value: 1 }] }]))
  assert.throws(() => formatPrometheus([{ name: 'ok', help: '', type: 'gauge', samples: [{ labels: { __reserved: 'x' }, value: 1 }] }]))
})

const input = (over: Partial<MetricsInput> = {}): MetricsInput => ({
  version: '2.38.0',
  collectedAt: 1_700_000_000_000,
  hosts: [{ id: 'default', online: true }],
  containers: [
    { name: 'web', host: 'default', project: 'site', image: 'nginx:1.27', running: true, health: 'healthy', cpuPercent: 12.5, memBytes: 52_428_800, updateAvailable: true, uptime: { '24h': 1, '7d': 0.99, '30d': null } },
    { name: 'job', host: 'default', project: null, image: 'restic:1', running: false, health: null, cpuPercent: null, memBytes: null, updateAvailable: null, uptime: null },
  ],
  domains: [{ domain: 'web.example.com', name: 'web', host: 'default', status: 200, ms: 42 }, { domain: 'down.example.com', name: 'web', host: 'default', status: 0, ms: 6000 }],
  ...over,
})

test('buildMetrics: per-container series in base units, with name/host/project labels', () => {
  const text = formatPrometheus(buildMetrics(input()))
  assert.ok(text.includes('homeport_build_info{version="2.38.0"} 1'))
  assert.ok(text.includes('homeport_collector_last_run_timestamp_seconds 1700000000'))
  assert.ok(text.includes('homeport_container_up{name="web",host="default",project="site"} 1'))
  assert.ok(text.includes('homeport_container_up{name="job",host="default"} 0'))
  assert.ok(text.includes('homeport_container_info{name="web",host="default",project="site",image="nginx:1.27"} 1'))
  assert.ok(text.includes('homeport_container_cpu_usage_ratio{name="web",host="default",project="site"} 0.125'))
  assert.ok(text.includes('homeport_container_memory_usage_bytes{name="web",host="default",project="site"} 52428800'))
  assert.ok(text.includes('homeport_container_update_available{name="web",host="default",project="site"} 1'))
  // health: a state set, only for containers with a health check
  assert.ok(text.includes('homeport_container_health_status{name="web",host="default",project="site",status="healthy"} 1'))
  assert.ok(text.includes('homeport_container_health_status{name="web",host="default",project="site",status="unhealthy"} 0'))
  assert.ok(!/health_status\{name="job"/.test(text))
  // uptime: one series per window that has data
  assert.ok(text.includes('homeport_container_uptime_ratio{name="web",host="default",project="site",window="7d"} 0.99'))
  assert.ok(!text.includes('window="30d"'))
  // a stopped container has no CPU or memory series rather than a fake 0
  assert.ok(!/cpu_usage_ratio\{name="job"/.test(text))
})

test('buildMetrics: domains follow the domain-alert rule; latency only when it answered', () => {
  const text = formatPrometheus(buildMetrics(input()))
  assert.ok(text.includes('homeport_domain_probe_success{domain="web.example.com",name="web",host="default"} 1'))
  assert.ok(text.includes('homeport_domain_probe_success{domain="down.example.com",name="web",host="default"} 0'))
  assert.ok(text.includes('homeport_domain_probe_duration_seconds{domain="web.example.com",name="web",host="default"} 0.042'))
  assert.ok(!text.includes('homeport_domain_probe_duration_seconds{domain="down.example.com"'))
  // domain checks off: no domain families at all (not "everything down")
  assert.ok(!formatPrometheus(buildMetrics(input({ domains: null }))).includes('homeport_domain_'))
})

test('buildMetrics: every family is a valid gauge or counter with a homeport_ name', () => {
  for (const f of buildMetrics(input())) {
    assert.match(f.name, /^homeport_[a-z_]+$/)
    assert.ok(f.type === 'gauge' || f.type === 'counter')
    assert.ok(f.help.length > 0)
  }
})
