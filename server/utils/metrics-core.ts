// Prometheus text exposition (format 0.0.4) for GET /api/metrics. Pure: the
// endpoint gathers its input (a collector snapshot, or the demo fleet) and this
// module turns it into metric families and text, so both are unit-testable.
//
// Names follow the Prometheus conventions (homeport_ prefix, base units, _bytes,
// _ratio, _seconds) and borrow from what people already scrape: cAdvisor's
// container_memory_usage_bytes and the scale of rate(container_cpu_usage_seconds_total),
// blackbox_exporter's probe_success / probe_duration_seconds / probe_http_status_code.

export type MetricType = 'gauge' | 'counter'

export interface MetricSample {
  labels?: Record<string, string | null | undefined>
  value: number
}

export interface MetricFamily {
  name: string
  help: string
  type: MetricType
  samples: MetricSample[]
}

const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/
const LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Label values: backslash, double quote and newline are escaped (in that order of concern). */
export const escapeLabelValue = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

/** HELP text: backslash and newline only (quotes are literal there). */
export const escapeHelp = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')

export function formatValue(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (v === Infinity) return '+Inf'
  if (v === -Infinity) return '-Inf'
  return String(v)
}

/**
 * Families to text. A family without samples is left out (no orphan HELP/TYPE).
 * An empty label value is left out too: Prometheus reads it as "no label" anyway.
 * Invalid metric or label names throw, since they are a bug here, never user data.
 */
export function formatPrometheus(families: MetricFamily[]): string {
  const out: string[] = []
  for (const f of families) {
    if (!NAME_RE.test(f.name)) throw new Error(`invalid metric name: ${f.name}`)
    if (!f.samples.length) continue
    out.push(`# HELP ${f.name} ${escapeHelp(f.help)}`)
    out.push(`# TYPE ${f.name} ${f.type}`)
    for (const s of f.samples) {
      const pairs: string[] = []
      for (const [k, v] of Object.entries(s.labels ?? {})) {
        if (!LABEL_RE.test(k) || k.startsWith('__')) throw new Error(`invalid label name: ${k}`)
        if (v == null || v === '') continue
        pairs.push(`${k}="${escapeLabelValue(String(v))}"`)
      }
      out.push(`${f.name}${pairs.length ? `{${pairs.join(',')}}` : ''} ${formatValue(s.value)}`)
    }
  }
  return out.join('\n') + '\n'
}

export interface MetricsContainer {
  name: string // docker container name
  host: string // host id (stable; the host's display name can be edited)
  project: string | null
  image: string
  running: boolean
  health: 'healthy' | 'unhealthy' | 'starting' | null
  /** docker stats' CPU %: 100 = one full core */
  cpuPercent: number | null
  memBytes: number | null
  /** null: update checks are off or this image was not checked yet */
  updateAvailable: boolean | null
  /** uptime ratio per window, null where nothing was observed; null for all when history is off */
  uptime: Record<string, number | null> | null
}

export interface MetricsDomain {
  domain: string
  name: string // the container it routes to
  host: string
  status: number // HTTP status, 0 = no answer
  ms: number
}

export interface MetricsInput {
  version: string
  /** when the collector last ran (unix ms), null before the first tick or in demo mode */
  collectedAt: number | null
  hosts: { id: string; online: boolean }[]
  containers: MetricsContainer[]
  /** null: domain checks are off (the families are left out, not reported as down) */
  domains: MetricsDomain[] | null
}

const HEALTH_STATES = ['healthy', 'unhealthy', 'starting'] as const

/** The same rule as domain alerts: no answer or a 5xx is down, a 4xx is the app answering. */
const probeOk = (status: number) => status > 0 && status < 500

export function buildMetrics(input: MetricsInput): MetricFamily[] {
  const id = (c: MetricsContainer) => ({ name: c.name, host: c.host, project: c.project })
  const fam = (name: string, help: string, samples: MetricSample[], type: MetricType = 'gauge'): MetricFamily => ({ name, help, type, samples })
  const cs = input.containers
  const families: MetricFamily[] = [
    fam('homeport_build_info', 'homeport version, always 1.', [{ labels: { version: input.version }, value: 1 }]),
  ]
  if (input.collectedAt != null) {
    families.push(
      fam('homeport_collector_last_run_timestamp_seconds', 'When the background collector last took a snapshot (the values below are from it).', [
        { value: Math.round(input.collectedAt / 1000) },
      ]),
    )
  }
  families.push(
    fam('homeport_host_up', 'Whether homeport can reach this Docker host (1) or not (0).', input.hosts.map((h) => ({ labels: { host: h.id }, value: h.online ? 1 : 0 }))),
    fam('homeport_container_info', 'Container metadata, always 1. Join on name and host for the image.', cs.map((c) => ({ labels: { ...id(c), image: c.image }, value: 1 }))),
    fam('homeport_container_up', 'Whether the container is running (1) or not (0).', cs.map((c) => ({ labels: id(c), value: c.running ? 1 : 0 }))),
    fam(
      'homeport_container_health_status',
      'Health check state, one series per state with 1 on the current one. Only containers that have a health check.',
      cs.filter((c) => c.health).flatMap((c) => HEALTH_STATES.map((st) => ({ labels: { ...id(c), status: st }, value: c.health === st ? 1 : 0 }))),
    ),
    fam(
      'homeport_container_cpu_usage_ratio',
      'CPU in use, in cores (1 = one full core, like docker stats at 100%). Same scale as rate(container_cpu_usage_seconds_total) in cAdvisor.',
      cs.filter((c) => c.running && c.cpuPercent != null).map((c) => ({ labels: id(c), value: Math.round(c.cpuPercent! * 10) / 1000 })),
    ),
    fam(
      'homeport_container_memory_usage_bytes',
      'Memory in use as docker stats shows it (page cache excluded).',
      cs.filter((c) => c.running && c.memBytes != null).map((c) => ({ labels: id(c), value: c.memBytes! })),
    ),
    fam(
      'homeport_container_update_available',
      'Whether the registry has a newer image for this tag (1) or not (0). Absent while update checks are off or the image was not checked yet.',
      cs.filter((c) => c.updateAvailable != null).map((c) => ({ labels: id(c), value: c.updateAvailable ? 1 : 0 })),
    ),
    fam(
      'homeport_container_uptime_ratio',
      'Share of collector samples in the window in which the container was running and not unhealthy (0 to 1). Absent while there is no data.',
      cs.flatMap((c) =>
        Object.entries(c.uptime ?? {})
          .filter(([, v]) => v != null)
          .map(([window, v]) => ({ labels: { ...id(c), window }, value: Math.round(v! * 1e6) / 1e6 })),
      ),
    ),
  )
  if (input.domains) {
    const ds = input.domains
    const dl = (d: MetricsDomain) => ({ domain: d.domain, name: d.name, host: d.host })
    families.push(
      fam('homeport_domain_probe_success', 'Whether the domain answered (1) or gave no answer or a 5xx (0), as in domain alerts.', ds.map((d) => ({ labels: dl(d), value: probeOk(d.status) ? 1 : 0 }))),
      fam('homeport_domain_probe_duration_seconds', 'How long the last check of the domain took.', ds.filter((d) => d.status > 0).map((d) => ({ labels: dl(d), value: d.ms / 1000 }))),
      fam('homeport_domain_probe_http_status_code', 'HTTP status of the last check (0 = no answer).', ds.map((d) => ({ labels: dl(d), value: d.status }))),
    )
  }
  return families
}
