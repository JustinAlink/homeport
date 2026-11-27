// The MCP endpoint's tools: read-only questions about the fleet, answered from the
// same data the dashboard shows. Pure: the data arrives through a FleetSource, so the
// tests can hand in a fixed fleet and server/utils/mcp.ts hands in the live one (or
// the demo).
//
// What a tool may touch is the line the auth exception for /api/mcp rests on: read
// tokens POST here, so everything below must be something a read token can already
// GET. Services, stats, update status, exposure, alerts and logs are; container
// environments, settings, files, compose and .env contents and backups are not, and
// FleetSource deliberately has no way to reach them.
//
// Answers are compact text a model reads well: one line per item, key=value facts,
// ids included so a follow-up call can name the exact container.

import type { Service, ServicesResponse, StatsMap } from '../../types/service.ts'
import { portScope, type ExposureLevel, type ExposureRoute, type ServiceExposure } from '../../shared/utils/exposure.ts'
import { proxyForDomains } from './ping-core.ts'
import type { McpTool } from './mcp-core.ts'

export interface AlertLike {
  id: string
  name: string
  host?: string
  kind: string
  from: string
  to: string
  at: number
}

export interface UpdateLike {
  status: string
  checkedAt: number
  error?: string
  newer?: { tag: string; bump: string }
  newerSameMajor?: { tag: string; bump: string }
  rebuilt?: { digest: string }
  /** the name a container listed by bare image id was created from */
  ref?: string
}

export interface LogLineLike {
  s: 'stdout' | 'stderr'
  t: string
  line: string
}

export interface ExposureReport {
  services: ServiceExposure[]
  summary: Record<ExposureLevel, number>
  probed: boolean
  pingEnabled: boolean
}

export interface FleetSource {
  services(): Promise<ServicesResponse>
  /** Latest CPU/memory per service id, or null when no recent sample exists (never a slow live sweep). */
  stats(): Promise<StatsMap | null>
  updates(): Promise<{ enabled: boolean; entries: Record<string, UpdateLike> }>
  exposure(opts: { probe: boolean; id?: string }): Promise<ExposureReport>
  alerts(limit: number): Promise<AlertLike[]>
  /** null while the logs capability is off (HOMEPORT_LOGS=false): get_logs is then not offered at all. */
  logs: ((id: string, tail: number) => Promise<LogLineLike[]>) | null
  alertsEnabled: boolean
  now: number
}

export const SERVER_INSTRUCTIONS = [
  'homeport is a read-only window on a self-hosted Docker fleet: containers, the reverse proxy routes (domains), image updates, how each app can be reached, alerts and logs. Nothing here changes anything.',
  'What serves a domain: find_domain. Unhealthy, crashed or restarting containers: list_services with status "problem". What needs updating: list_updates. What is reachable around the reverse proxy or open on every interface: exposure_report.',
  'Arguments that name a service take a container name, a homeport service id (from list_services) or one of its domains.',
].join('\n')

// ---------- helpers (exported for the tests) ----------

/** The host part of a service id: `<hostId>::<containerId>`, or "default" for single-host ids. */
export const hostKeyOf = (id: string) => {
  const sep = id.indexOf('::')
  return sep >= 0 ? id.slice(0, sep) : 'default'
}

/** `https://App.Example.com:443/path?x` → `app.example.com`: what a person pastes, reduced to the host the proxy routes on. */
export function normDomain(input: string): string {
  let s = input.trim().toLowerCase()
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  s = s.split(/[/?#]/)[0]
  s = s.replace(/^[^@]*@/, '')
  s = s.replace(/:\d+$/, '')
  return s.replace(/\.$/, '')
}

/** Does a proxy route's domain serve this host? A `*.example.com` route covers one label. */
export function domainMatches(routeDomain: string, host: string): boolean {
  const d = routeDomain.toLowerCase()
  if (d === host) return true
  if (d.startsWith('*.')) {
    const suffix = d.slice(1)
    return host.endsWith(suffix) && host.length > suffix.length && !host.slice(0, -suffix.length).includes('.')
  }
  return false
}

const exitCodeOf = (s: Service) => (s.state === 'exited' ? /Exited \((-?\d+)\)/.exec(s.statusText)?.[1] ?? null : null)

/**
 * Why a service needs attention, or null. Exited 0, 130 and 143 are clean stops
 * (normal exit, Ctrl-C, docker stop's SIGTERM). 137 is SIGKILL, which is also what a
 * plain `docker stop` ends in for any app that ignores SIGTERM: counting it filled the
 * problem list with containers someone simply stopped (seen on a real fleet), so it
 * is named in the state instead (stateText) and left out here.
 */
export function problemOf(s: Service): string | null {
  if (s.health === 'unhealthy') return 'unhealthy'
  if (s.state === 'restarting') return 'restarting'
  if (s.state === 'dead') return 'dead'
  if (s.state === 'failed') return 'failed'
  const code = exitCodeOf(s)
  if (code && !['0', '130', '137', '143'].includes(code)) return `exited with code ${code}`
  return null
}

export type Resolved = { service: Service } | { error: string }

/** Find one service by id, name, display name, domain, or a unique part of its name. */
export function resolveService(services: Service[], query: string): Resolved {
  const q = query.trim()
  if (!q) return { error: 'Name a service: a container name, an id from list_services, or a domain.' }
  const lower = q.toLowerCase()
  const pick = (hits: Service[], how: string): Resolved | null => {
    if (hits.length === 1) return { service: hits[0] }
    if (hits.length > 1)
      return {
        error: `"${q}" ${how} ${hits.length} services: ${hits.slice(0, 12).map((s) => `${s.name}${s.host ? ` on ${s.host}` : ''} (id ${s.id})`).join(', ')}${hits.length > 12 ? ', ...' : ''}. Ask again with the id.`,
      }
    return null
  }
  const byId = services.find((s) => s.id === q)
  if (byId) return { service: byId }
  const exact = pick(services.filter((s) => s.name.toLowerCase() === lower || s.displayName.toLowerCase() === lower), 'names')
  if (exact) return exact
  const host = normDomain(q)
  const byDomain = host.includes('.') ? pick(services.filter((s) => s.domains.some((d) => domainMatches(d.domain, host))), 'is a domain of') : null
  if (byDomain) return byDomain
  const partial = pick(services.filter((s) => s.name.toLowerCase().includes(lower) || s.displayName.toLowerCase().includes(lower)), 'matches')
  if (partial) return partial
  return { error: `No service matches "${q}". list_services shows every name and id.` }
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.round(n / 1024)} KB`
}

/** A digest-pinned image reads better with a short digest: `x:1.2@sha256:1f1f1f1f1f1f`. */
export const shortImage = (image: string) => image.replace(/@sha256:([0-9a-f]{12})[0-9a-f]+/, '@sha256:$1')

function stateText(s: Service): string {
  const parts = [s.state]
  if (s.health) parts.push(s.health)
  const problem = problemOf(s)
  if (problem && !parts.includes(problem)) parts.push(problem)
  if (exitCodeOf(s) === '137') parts.push('killed (exit 137: a stop that timed out, or out of memory)')
  return parts.join(', ')
}

function portText(p: Service['ports'][number]): string {
  const scope = portScope(p.addrs)
  const addr = scope === 'all' ? '0.0.0.0' : (p.addrs ?? [])[0]
  return `${addr}:${p.hostPort}->${p.containerPort}/${p.type}${scope === 'all' ? ' (every interface)' : ''}`
}

// a port published on IPv4 and IPv6 is one fact to a reader
function portsText(s: Service): string {
  return [...new Set(s.ports.map(portText))].join(', ')
}

function usageText(st: StatsMap | null, id: string): string | null {
  const u = st?.[id]
  if (!u) return null
  const cpu = u.cpuPercent === null ? null : `cpu=${u.cpuPercent}%`
  const mem = u.memBytes ? `mem=${bytes(u.memBytes)}${u.memLimitBytes ? ` of ${bytes(u.memLimitBytes)}` : ''}` : null
  return [cpu, mem].filter(Boolean).join('; ') || null
}

function routeAccessText(r: ExposureRoute, probed: boolean): string {
  if (!probed || r.access === 'unchecked') return 'not checked'
  switch (r.access) {
    case 'login':
      return `asks for a login (HTTP ${r.status})`
    case 'sso':
      return `sends visitors to a sign-in at ${r.signIn} (HTTP ${r.status})`
    case 'open':
      // the proxy put no login in front; the app may still show its own
      return `opens for anyone, no login in front of the app (HTTP ${r.status})`
    case 'refused':
      return 'refuses anonymous visitors (HTTP 403)'
    case 'down':
      return 'no answer'
    default:
      return `answers HTTP ${r.status}`
  }
}

function plainHttpText(r: ExposureRoute, probed: boolean): string {
  if (!r.https) return 'no HTTPS: served over plain http'
  if (!probed || r.plainHttp === null) return 'http:// not checked'
  return r.plainHttp ? 'http:// still serves it instead of redirecting to HTTPS' : 'http:// redirects to HTTPS'
}

function findingsText(e: ServiceExposure, withFix: boolean): string[] {
  const out: string[] = []
  for (const f of e.findings) {
    out.push(`  [${f.level}] ${f.title}. ${f.detail}`)
    if (withFix) {
      out.push(`    Fix: ${f.fix.replace(/`/g, '')}`)
      if (f.snippet) out.push(`    In the compose file: ${f.snippet.from} -> ${f.snippet.to}`)
    }
  }
  for (const a of e.accepted) out.push(`  [accepted] ${a.title} (accepted ${iso(a.at)}: "${a.note}")`)
  return out
}

// the exposure page's words (utils/exposureText.ts), so the answer matches what the user sees
const LEVEL_TEXT: Record<ExposureLevel, string> = {
  risk: 'needs attention',
  warn: 'worth a look',
  open: 'open ports',
  proxied: 'through the proxy',
  internal: 'not published',
}

function updateReasons(e: UpdateLike): string[] {
  const out: string[] = []
  if (e.status === 'update') out.push('a new image was published for the tag it runs (pull and recreate to update)')
  if (e.newer) out.push(`newer version ${e.newer.tag} (${e.newer.bump})`)
  if (e.newerSameMajor) out.push(`on its current major: ${e.newerSameMajor.tag} (${e.newerSameMajor.bump})`)
  if (e.rebuilt) out.push('its pinned tag was rebuilt since (same version, new digest, often security fixes)')
  return out
}

// ---------- tools ----------

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
// probing a domain sends a request out to it
const READ_ONLY_PROBING = { ...READ_ONLY, openWorldHint: true }

const SERVICE_ARG = { type: 'string' as const, description: 'Container name, homeport service id (from list_services) or one of its domains.', maxLength: 300 }

const STATUS = ['all', 'running', 'stopped', 'problem']

const listServices: McpTool<FleetSource> = {
  name: 'list_services',
  title: 'List services',
  description:
    'Every container (and host systemd unit, when shown) homeport sees: state, health, image, group, domains, published ports, CPU and memory, and its id. status "problem" lists only the ones that need attention: unhealthy, restarting, dead, or exited with an error.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: STATUS, default: 'all', description: 'all (default), running, stopped, or problem (unhealthy, restarting, crashed).' },
      query: { type: 'string', maxLength: 200, description: 'Only services whose name, image, group or domain contains this text.' },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async run(args, src) {
    const status = (args.status as string | undefined) ?? 'all'
    const q = String(args.query ?? '').trim().toLowerCase()
    const [svc, st] = await Promise.all([src.services(), src.stats()])
    const all = svc.services
    const problems = all.filter((s) => problemOf(s))
    let list = all
    if (status === 'running') list = list.filter((s) => s.state === 'running')
    else if (status === 'stopped') list = list.filter((s) => s.state !== 'running')
    else if (status === 'problem') list = problems
    if (q) list = list.filter((s) => [s.name, s.displayName, s.image, s.group, ...s.domains.map((d) => d.domain)].some((v) => v.toLowerCase().includes(q)))

    const containers = all.filter((s) => s.kind === 'container')
    const units = all.length - containers.length
    const head = [
      `${containers.length} containers, ${containers.filter((s) => s.state === 'running').length} running${units ? `; ${units} systemd units` : ''}. ` +
        `Problems: ${problems.length ? problems.map((s) => `${s.name} (${problemOf(s)})`).join(', ') : 'none'}.`,
      `Domains come from: ${svc.domainProvider ?? 'no reverse proxy found'}.`,
    ]
    const offline = svc.hosts.filter((h) => !h.online)
    if (offline.length) head.push(`Unreachable hosts (their containers are missing below): ${offline.map((h) => `${h.name}${h.error ? ` (${h.error})` : ''}`).join(', ')}.`)
    if (svc.unmatched.length) head.push(`${svc.unmatched.length} proxy route(s) point at no container: ${svc.unmatched.map((u) => u.domains.join(', ')).join('; ')}.`)
    if (!list.length) return { text: `${head.join('\n')}\nNo services match${q ? ` "${q}"` : ''}${status !== 'all' ? ` with status ${status}` : ''}.` }

    const lines = list.map((s) => {
      const facts = [
        `image=${shortImage(s.image)}`,
        s.kind === 'systemd' ? 'kind=systemd' : null,
        s.host ? `host=${s.host}` : null,
        `group=${s.group}`,
        s.domains.length ? `domains=${s.domains.map((d) => d.url).join(', ')}` : null,
        s.ports.length ? `ports=${portsText(s)}` : null,
        usageText(st, s.id),
        s.hidden ? 'hidden from the dashboard' : null,
        `id=${s.id}`,
      ].filter(Boolean)
      return `- ${s.name} [${stateText(s)}] ${facts.join('; ')}`
    })
    return { text: `${head.join('\n')}\n${status === 'all' && !q ? 'All' : 'Matching'} services (${list.length}):\n${lines.join('\n')}` }
  },
}

const getService: McpTool<FleetSource> = {
  name: 'get_service',
  title: 'Service details',
  description:
    'Everything homeport knows about one container: state and health, image and update status, compose project, published ports, networks, domains and how the proxy reaches it, CPU and memory, exposure findings and its recent alerts. Never its environment or files.',
  inputSchema: { type: 'object', properties: { service: SERVICE_ARG }, required: ['service'], additionalProperties: false },
  annotations: READ_ONLY,
  async run(args, src) {
    const svc = await src.services()
    const r = resolveService(svc.services, String(args.service))
    if ('error' in r) return { text: r.error, isError: true }
    const s = r.service
    const [st, upd, alerts, exp] = await Promise.all([
      src.stats(),
      src.updates(),
      src.alerts(200),
      s.kind === 'container' && s.state === 'running' ? src.exposure({ probe: false, id: s.id }) : Promise.resolve(null),
    ])
    const lines = [`${s.name}${s.displayName !== s.name ? ` ("${s.displayName}")` : ''}: ${s.kind}, id ${s.id}`]
    lines.push(`state: ${stateText(s)} (${s.statusText})`)
    if (s.host) lines.push(`host: ${s.host}`)
    lines.push(`image: ${s.image}`)
    if (s.kind === 'container') {
      const e = upd.entries[`${hostKeyOf(s.id)}|${s.image}`]
      if (!upd.enabled) lines.push('updates: not checked (update checks are off)')
      else if (!e) lines.push('updates: not checked yet')
      else if (e.status === 'error') lines.push(`updates: the last check failed (${e.error ?? 'unknown error'})`)
      else {
        const why = updateReasons(e)
        lines.push(`updates: ${why.length ? why.join('; ') : e.status === 'local' ? 'built locally, no registry to compare with' : 'up to date'} (checked ${ago(e.checkedAt, src.now)})`)
      }
    }
    lines.push(`group: ${s.group}${s.project ? ` (compose project ${s.project}${s.composeService ? `, service ${s.composeService}` : ''})` : ' (not from a compose project)'}`)
    if (s.createdAt) lines.push(`created: ${iso(s.createdAt)}`)
    if (s.kind === 'container') {
      lines.push(`ports: ${s.ports.length ? portsText(s) : 'none published'}`)
      if (s.internalPorts?.length) lines.push(`container ports: ${s.internalPorts.join(', ')}`)
      if (s.networks?.length) lines.push(`networks: ${s.networks.join(', ')}`)
      lines.push(
        `domains: ${
          s.domains.length
            ? s.domains
                .map((d) => `${d.url}${d.via ? ` (proxy reaches it by ${d.via === 'name' ? 'container name' : 'host IP and published port'}${d.port ? ` on port ${d.port}` : ''})` : ''}`)
                .join(', ')
            : 'none'
        }`,
      )
      if (s.dockerSocket) lines.push('docker socket: mounted (whoever controls this container controls Docker)')
      const use = usageText(st, s.id)
      if (use) lines.push(`usage: ${use.replace(/=/g, ' ')}`)
    }
    if (s.hidden) lines.push('hidden from the dashboard (hub.hide label)')
    if (s.noalert) lines.push('alerts: muted for this service (hub.noalert label)')
    const e = exp?.services[0]
    if (e) {
      lines.push(`exposure: ${e.level} (${LEVEL_TEXT[e.level]})${e.findings.length || e.accepted.length ? '' : ', no findings'}`)
      lines.push(...findingsText(e, true))
    }
    const mine = alerts.filter((a) => a.id === s.id || a.name === s.name).slice(0, 5)
    if (mine.length) lines.push('recent alerts:', ...mine.map((a) => `  ${iso(a.at)} ${a.kind}: ${a.from} -> ${a.to}`))
    return { text: lines.join('\n') }
  },
}

const findDomain: McpTool<FleetSource> = {
  name: 'find_domain',
  title: 'What serves a domain',
  description:
    'Which container serves a domain, through which reverse proxy and how the proxy reaches it, whether it has HTTPS, and (probe, on by default) what an anonymous visitor gets: a login, a sign-in portal, the open app, or no answer. Accepts a bare host or a full URL.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: { type: 'string', maxLength: 300, description: 'A domain or URL, e.g. app.example.com or https://app.example.com/path.' },
      probe: { type: 'boolean', default: true, description: 'Ask the domain what an anonymous visitor gets (a few seconds at most, cached for a minute). Default true.' },
    },
    required: ['domain'],
    additionalProperties: false,
  },
  annotations: READ_ONLY_PROBING,
  async run(args, src) {
    const host = normDomain(String(args.domain))
    if (!host) return { text: 'Give a domain such as app.example.com.', isError: true }
    const svc = await src.services()
    const hits = svc.services.filter((s) => s.domains.some((d) => domainMatches(d.domain, host)))
    if (!hits.length) {
      const stale = svc.unmatched.find((u) => u.domains.some((d) => domainMatches(d, host)))
      if (stale)
        return {
          text: `${host} has a reverse proxy route (to ${stale.upstream}, ${stale.ssl ? 'HTTPS' : 'no HTTPS'}), but no container matches that upstream: no container has that name or publishes that port. Likely a stale route, or an app outside Docker.`,
        }
      const near = [...new Set(svc.services.flatMap((s) => s.domains.map((d) => d.domain)))].filter((d) => {
        const first = host.split('.')[0]
        return d.includes(host) || host.includes(d) || (first.length > 2 && d.includes(first))
      })
      return {
        text: `No reverse proxy route for ${host} was found${svc.domainProvider ? ` in ${svc.domainProvider}` : ' (no reverse proxy config was found at all)'}.${near.length ? ` Similar domains: ${near.slice(0, 10).join(', ')}.` : ''}`,
      }
    }
    const probe = args.probe !== false
    const out: string[] = []
    for (const s of hits) {
      const d = s.domains.find((x) => domainMatches(x.domain, host))!
      // the proxy that serves this domain's source (a Pangolin domain has none on the host)
      const proxy = proxyForDomains(svc.services, s.host).get(d.url) ?? null
      out.push(`${host} is served by ${s.kind} "${s.name}"${s.host ? ` on host ${s.host}` : ''} (id ${s.id}; image ${shortImage(s.image)}; ${stateText(s)}).`)
      const how = d.via === 'name' ? 'by container name' : d.via === 'ip' ? 'through a port published on the host' : 'by a route homeport matched'
      out.push(
        `Route: ${d.url}${d.domain !== host ? ` (wildcard route ${d.domain})` : ''}, ${d.ssl ? 'HTTPS' : 'no HTTPS'}. The reverse proxy (${svc.domainProvider ?? 'unknown'}${proxy ? `, container ${proxy}` : ''}) reaches it ${how}${d.port ? `, forwarding to port ${d.port}` : ''}.`,
      )
      if (s.kind === 'container' && s.state === 'running') {
        const rep = await src.exposure({ probe, id: s.id })
        const e = rep.services[0]
        const r = e?.routes.find((x) => x.url === d.url)
        if (r) {
          const note = !probe ? ' (not probed: probe was false)' : !rep.probed ? ' (not probed: domain checks are off in homeport)' : ''
          out.push(`Anonymous visitor: ${routeAccessText(r, rep.probed)}${note}. ${plainHttpText(r, rep.probed)}.`)
        }
        if (e) {
          out.push(`Exposure: ${e.level} (${LEVEL_TEXT[e.level]}).`)
          out.push(...findingsText(e, false))
        }
      } else {
        out.push('The container is not running, so the domain cannot reach it now.')
      }
      const others = s.domains.filter((x) => x.url !== d.url).map((x) => x.domain)
      if (others.length) out.push(`Its other domains: ${others.join(', ')}.`)
    }
    if (hits.length > 1) out.unshift(`${hits.length} containers have a route for ${host} (one per host, or a duplicate route):`)
    return { text: out.join('\n') }
  },
}

const listUpdates: McpTool<FleetSource> = {
  name: 'list_updates',
  title: 'What needs updating',
  description:
    'Containers whose image has an update: a new image for the tag they run, a newer version tag, or a rebuilt pinned tag. Also says how many are up to date, not checked yet, or failed their check. Answers from homeport\'s last registry check; it does not query registries itself.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: READ_ONLY,
  async run(_args, src) {
    const [upd, svc] = await Promise.all([src.updates(), src.services()])
    if (!upd.enabled) return { text: 'Update checks are off in homeport (Settings > Updates, or HOMEPORT_UPDATE_CHECK=true), so there is no update information.' }
    const containers = svc.services.filter((s) => s.kind === 'container')
    const need: string[] = []
    const failed: string[] = []
    let current = 0
    let unchecked = 0
    let local = 0
    let newest = 0
    for (const s of containers) {
      const e = upd.entries[`${hostKeyOf(s.id)}|${s.image}`]
      if (!e) {
        unchecked++
        continue
      }
      newest = Math.max(newest, e.checkedAt)
      if (e.status === 'error') {
        failed.push(`${s.name} (${e.error ?? 'unknown error'})`)
        continue
      }
      const why = updateReasons(e)
      if (why.length) need.push(`- ${s.name}${s.host ? ` on ${s.host}` : ''} (${shortImage(e.ref ?? s.image)}): ${why.join('; ')}; id=${s.id}`)
      else if (e.status === 'local') local++
      else current++
    }
    const lines = [`Update checks: on. ${containers.length} containers${newest ? `, last checked ${ago(newest, src.now)}` : ''}.`]
    lines.push(need.length ? `Updates available (${need.length}):\n${need.join('\n')}` : 'Nothing needs updating.')
    const tail = [`up to date: ${current}`, local ? `built locally (nothing to compare): ${local}` : null, `not checked yet: ${unchecked}`, `check failed: ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''}`]
    lines.push(`${tail.filter(Boolean).join('; ')}.`)
    return { text: lines.join('\n') }
  },
}

const exposureReport: McpTool<FleetSource> = {
  name: 'exposure_report',
  title: 'Exposure report',
  description:
    'How every running container can be reached: through the reverse proxy (a domain) and/or a port published on the host. Findings, worst first, each with why it matters and the fix: reachable around the proxy, mounts the Docker socket, proxy admin port open, database open, no HTTPS, plain HTTP not redirected, open ports. Findings the admin accepted as intended are listed separately.',
  inputSchema: {
    type: 'object',
    properties: {
      level: {
        type: 'string',
        enum: ['attention', 'all', 'risk', 'warn', 'open', 'proxied', 'internal'],
        default: 'attention',
        description: 'attention (default): every container with a finding. all: every running container. Or one level.',
      },
      probe: { type: 'boolean', default: false, description: 'Also ask each domain what an anonymous visitor gets, which finds plain-HTTP leaks (slower). Default false.' },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY_PROBING,
  async run(args, src) {
    const level = (args.level as string | undefined) ?? 'attention'
    const rep = await src.exposure({ probe: args.probe === true })
    const s = rep.summary
    const lines = [
      `${rep.services.length} running containers by level: ${(Object.keys(LEVEL_TEXT) as ExposureLevel[]).map((l) => `${l} ${s[l]} (${LEVEL_TEXT[l]})`).join(', ')}.`,
      rep.probed ? 'Domains were probed.' : args.probe === true && !rep.pingEnabled ? 'Domains were not probed: domain checks are off in homeport.' : 'Domains were not probed (pass probe true to check logins and plain-HTTP redirects).',
    ]
    const list =
      level === 'attention' ? rep.services.filter((e) => e.findings.length) : level === 'all' ? rep.services : rep.services.filter((e) => e.level === level)
    if (!list.length) {
      lines.push(level === 'attention' ? 'No findings: nothing is reachable in a way that needs a look.' : `No containers at level ${level}.`)
      return { text: lines.join('\n') }
    }
    for (const e of list) {
      const how = [
        e.routes.length ? `domains ${e.routes.map((r) => `${r.domain}${r.https ? '' : ' (no HTTPS)'}${rep.probed ? `: ${routeAccessText(r, true)}` : ''}`).join(', ')}` : null,
        e.ports.length ? `ports ${[...new Set(e.ports.map((p) => `${p.hostPort}/${p.type} ${p.scope === 'all' ? 'every interface' : p.scope === 'loopback' ? 'this machine only' : p.addrs.join(' ')}`))].join(', ')}` : null,
      ].filter(Boolean)
      lines.push(`- ${e.name}${e.host ? ` on ${e.host}` : ''} [${e.level}]${e.role === 'proxy' ? ' (the reverse proxy)' : ''}: ${how.join('; ') || 'nothing published'}; id=${e.id}`)
      lines.push(...findingsText(e, true))
    }
    if (level === 'attention') {
      const accepted = rep.services.filter((e) => !e.findings.length && e.accepted.length)
      if (accepted.length) lines.push(`Accepted as intended (not counted): ${accepted.map((e) => `${e.name} (${e.accepted.map((a) => `${a.code}: "${a.note}"`).join('; ')})`).join(', ')}.`)
    }
    return { text: lines.join('\n') }
  },
}

const recentAlerts: McpTool<FleetSource> = {
  name: 'recent_alerts',
  title: 'Recent alerts',
  description: 'The newest alert events homeport recorded: containers going down, unhealthy or recovering, domains failing, updates found and applied. Newest first.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'How many events (1 to 100, default 20).' },
      service: { type: 'string', maxLength: 200, description: 'Only events whose container name contains this text.' },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async run(args, src) {
    const limit = (args.limit as number | undefined) ?? 20
    const q = String(args.service ?? '').trim().toLowerCase()
    let list = await src.alerts(q ? 200 : limit)
    if (q) list = list.filter((a) => a.name.toLowerCase().includes(q)).slice(0, limit)
    if (!list.length) {
      const hint = src.alertsEnabled ? '' : ' Alerting is off in homeport (Settings > Monitoring & alerts), so container state changes are not being recorded.'
      return { text: `No alert events recorded${q ? ` for "${q}"` : ''}.${hint}` }
    }
    const change = (a: AlertLike) => (a.from && a.to ? `, ${a.from} -> ${a.to}` : a.from || a.to ? `, ${a.from || a.to}` : '')
    const lines = list.map((a) => `${iso(a.at)} (${ago(a.at, src.now)}) ${a.kind}: ${a.name}${a.host ? ` on ${a.host}` : ''}${change(a)}`)
    return { text: `${list.length} most recent alert events${q ? ` for "${q}"` : ''}, newest first:\n${lines.join('\n')}` }
  },
}

export const MAX_LOG_LINES = 500
/** With a text filter, this many recent lines are searched for matches. */
const LOG_SEARCH_WINDOW = 2000
const LOG_LINE_CHARS = 500

const getLogs: McpTool<FleetSource> = {
  name: 'get_logs',
  title: 'Container logs',
  description: `The last lines a container wrote to stdout and stderr, oldest first, with timestamps. At most ${MAX_LOG_LINES} lines; "contains" searches the last ${LOG_SEARCH_WINDOW} lines for a text (case-insensitive).`,
  inputSchema: {
    type: 'object',
    properties: {
      service: SERVICE_ARG,
      lines: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES, default: 100, description: `How many lines (1 to ${MAX_LOG_LINES}, default 100).` },
      contains: { type: 'string', maxLength: 200, description: 'Only lines containing this text, e.g. "error".' },
    },
    required: ['service'],
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async run(args, src) {
    if (!src.logs) return { text: 'Logs are switched off in homeport (HOMEPORT_LOGS=false).', isError: true }
    const svc = await src.services()
    const r = resolveService(svc.services, String(args.service))
    if ('error' in r) return { text: r.error, isError: true }
    const s = r.service
    if (s.kind !== 'container') return { text: `${s.name} is a systemd unit; homeport reads logs of containers only.`, isError: true }
    const n = (args.lines as number | undefined) ?? 100
    const needle = String(args.contains ?? '').toLowerCase()
    let lines = await src.logs(s.id, needle ? LOG_SEARCH_WINDOW : n)
    const fetched = lines.length
    if (needle) lines = lines.filter((l) => l.line.toLowerCase().includes(needle)).slice(-n)
    if (!lines.length) return { text: needle ? `No line containing "${needle}" in the last ${fetched} lines of ${s.name}.` : `${s.name} has written no log lines.` }
    const head = needle
      ? `${lines.length} line(s) containing "${needle}" in the last ${fetched} lines of ${s.name} (id ${s.id}), oldest first; stderr lines start with "!":`
      : `Last ${lines.length} log lines of ${s.name} (id ${s.id}), oldest first; stderr lines start with "!":`
    const body = lines.map((l) => {
      const text = l.line.length > LOG_LINE_CHARS ? `${l.line.slice(0, LOG_LINE_CHARS)}[...]` : l.line
      return `${l.t ? `${l.t.replace(/\.\d+Z$/, 'Z')} ` : ''}${l.s === 'stderr' ? '! ' : ''}${text}`
    })
    return { text: `${head}\n${body.join('\n')}` }
  },
}

/** The tools on offer, in a fixed order (clients cache the list). get_logs only while logs are on. */
export function fleetTools(src: FleetSource): McpTool<FleetSource>[] {
  return [listServices, getService, findDomain, listUpdates, exposureReport, recentAlerts, ...(src.logs ? [getLogs] : [])]
}

