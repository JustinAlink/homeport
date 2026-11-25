// Exposure: how each running container can be reached, through the reverse proxy
// (a domain) and/or straight through a port published on the host. Pure: the
// server's report, the sidebar badge and the unit tests apply the same rules.
//
// Wording rule: say what is reachable and how, never just "insecure". A port open
// on every interface may still be LAN-only behind a router, and an app may have
// its own login. The report states the fact, why it can matter, and the fix, and
// keeps red for the cases that bypass something the user set up on purpose.

import type { Service } from '../../types/service.ts'

export type PortScope = 'all' | 'loopback' | 'specific'
/** What an anonymous visitor gets from a domain (probed from homeport). */
export type RouteAccess = 'login' | 'sso' | 'open' | 'refused' | 'error' | 'down' | 'unchecked'
export type ExposureLevel = 'risk' | 'warn' | 'open' | 'proxied' | 'internal'
export const EXPOSURE_LEVELS: ExposureLevel[] = ['risk', 'warn', 'open', 'proxied', 'internal']

export interface ExposureInput {
  id: string
  /** Stable across recreates (container ids are not): `<hostId>|<container name>`. Accepted findings hang off it. */
  key: string
  name: string
  image: string
  host?: string
  /** The reverse proxy itself: its 80/443 being open is the point. */
  isProxy: boolean
  dockerSocket?: boolean
  ports: { hostPort: number; containerPort: number; type: string; addrs?: string[] }[]
  domains: { domain: string; url: string; ssl: boolean; via?: 'name' | 'ip'; port?: number }[]
}

export interface DomainProbe {
  status: number
  location?: string
  /** The same domain over plain http://, probed for HTTPS routes only. */
  http?: { status: number; location?: string }
}

export interface ExposureRoute {
  domain: string
  url: string
  https: boolean
  access: RouteAccess
  status: number
  /** The host a sign-in redirect points at (forward-auth / SSO portal). */
  signIn?: string
  /** For HTTPS routes: does http:// still serve the app? null = not checked. */
  plainHttp: boolean | null
}

export interface ExposurePort {
  hostPort: number
  containerPort: number
  type: string
  scope: PortScope
  addrs: string[]
}

export interface ExposureFinding {
  code: string
  level: 'risk' | 'warn' | 'open'
  title: string
  detail: string
  fix: string
  /** The compose `ports:` line before and after the safe fix, when there is one to show. */
  snippet?: { from: string; to: string }
  /** Host ports this finding is about, so the UI marks those and not every open port. */
  ports?: number[]
}

/** A finding the admin marked as intended, with their reason. */
export interface ExposureAck {
  note: string
  at: number
}

export interface ServiceExposure {
  id: string
  key: string
  name: string
  image: string
  host?: string
  role: 'proxy' | 'app'
  level: ExposureLevel
  routes: ExposureRoute[]
  ports: ExposurePort[]
  findings: ExposureFinding[]
  /** Findings accepted as intended: shown, but no longer counted. */
  accepted: (ExposureFinding & ExposureAck)[]
  dockerSocket: boolean
}

/** Where an accepted finding is stored: per container (by name, so it survives a recreate) and per rule. */
export const ackKey = (key: string, code: string) => `${key}|${code}`

/** The finding codes Accept may store (anything else is refused). */
export const FINDING_CODES = ['around-proxy', 'docker-control', 'proxy-admin-open', 'database-open', 'open-port', 'plain-http', 'http-not-redirected']

/** One builder for the server, the demo and the sidebar badge, so all three judge the same input. */
export function exposureInput(s: Service, isProxy: boolean): ExposureInput {
  const sep = s.id.indexOf('::')
  const hostId = sep >= 0 ? s.id.slice(0, sep) : 'default'
  return { id: s.id, key: `${hostId}|${s.name}`, name: s.displayName, image: s.image, host: s.host, isProxy, dockerSocket: s.dockerSocket, ports: s.ports, domains: s.domains }
}

const EVERY_INTERFACE = new Set(['', '0.0.0.0', '::'])

/** Where a published port listens. No address at all is Docker's default: every interface. */
export function portScope(addrs?: string[]): PortScope {
  if (!addrs || !addrs.length || addrs.some((a) => EVERY_INTERFACE.has(a))) return 'all'
  if (addrs.every((a) => a.startsWith('127.') || a === '::1')) return 'loopback'
  return 'specific'
}

const SIGN_IN_HOST = /^(auth|login|sso|id|identity|accounts?|authelia|authentik|keycloak|oauth|signin)[.-]/i
const SIGN_IN_PATH = /\/(login|log-in|signin|sign-in|auth|oauth2?|sso|authorize|flows?)(\/|$|\?|\.)/i

/** Classify what an anonymous request to a domain returned. */
export function routeAccess(p: DomainProbe | undefined, domain: string): { access: RouteAccess; signIn?: string } {
  if (!p) return { access: 'unchecked' }
  if (p.status === 0) return { access: 'down' }
  if (p.status === 401) return { access: 'login' }
  if (p.status === 403) return { access: 'refused' }
  if (p.status >= 300 && p.status < 400) {
    let target: URL | null = null
    try {
      target = p.location ? new URL(p.location, `https://${domain}/`) : null
    } catch {
      target = null
    }
    if (target) {
      const elsewhere = target.hostname.toLowerCase() !== domain.toLowerCase()
      const signInPath = SIGN_IN_PATH.test(`${target.pathname}${target.search}`)
      if (elsewhere && (SIGN_IN_HOST.test(target.hostname) || signInPath)) return { access: 'sso', signIn: target.hostname }
      if (!elsewhere && signInPath) return { access: 'login' }
    }
    // a redirect inside the app (/ to /web/): the page itself opens for anyone
    return { access: 'open' }
  }
  if (p.status >= 200 && p.status < 300) return { access: 'open' }
  return { access: 'error' }
}

/** Does http:// still serve the app (or a password prompt) instead of redirecting to https? */
export function plainHttpServed(h: DomainProbe['http']): boolean | null {
  if (!h) return null
  if (h.status === 0) return false // nothing on port 80: nothing to leak there
  if (h.status >= 300 && h.status < 400) return !(h.location && /^https:/i.test(h.location))
  // a 401 counts: a login prompt over http sends the password in the clear
  return (h.status >= 200 && h.status < 300) || h.status === 401
}

// The proxy's own admin surfaces, by image. Its 80/443 are meant to be open; these are not.
const PROXY_ADMIN: { match: RegExp; port: number; what: string; level: 'risk' | 'warn' }[] = [
  { match: /nginx-proxy-manager/, port: 81, what: "Nginx Proxy Manager's admin UI", level: 'warn' },
  { match: /(^|\/)traefik(:|@|$)/, port: 8080, what: "Traefik's dashboard and API", level: 'warn' },
  { match: /caddy/, port: 2019, what: "Caddy's admin API, which has no login and can rewrite the whole config", level: 'risk' },
]

const DATA_STORE = /(^|\/)(postgres|postgresql|postgis|timescaledb|mysql|mariadb|mongo|mongodb|redis|valkey|keydb|memcached|influxdb|elasticsearch|opensearch|couchdb|clickhouse-server|cassandra|rabbitmq|mosquitto)(:|@|$)/

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
// a port published for tcp and udp is one port to a reader
const hostPorts = (ps: ExposurePort[]) => [...new Set(ps.map((p) => p.hostPort))]
const portsText = (ps: ExposurePort[]) => {
  const n = hostPorts(ps)
  return n.length === 1 ? `port ${n[0]}` : `ports ${list(n.map(String))}`
}
const isAre = (ps: ExposurePort[]) => (hostPorts(ps).length === 1 ? 'is' : 'are')
const cap = (t: string) => t[0].toUpperCase() + t.slice(1)
const bindExample = (p: ExposurePort) => `\`127.0.0.1:${p.hostPort}:${p.containerPort}\``
const proto = (p: ExposurePort) => (p.type === 'udp' ? '/udp' : '')
const localSnippet = (p: ExposurePort) => ({ from: `"${p.hostPort}:${p.containerPort}${proto(p)}"`, to: `"127.0.0.1:${p.hostPort}:${p.containerPort}${proto(p)}"` })
const FIREWALL = 'Docker publishes ports around ufw and firewalld, so a host firewall does not close them.'
const RANK: Record<ExposureLevel, number> = { risk: 0, warn: 1, open: 2, proxied: 3, internal: 4 }

/**
 * The full picture for one container. `probes` is keyed by route URL; missing probes
 * read as "not checked". `acks` (keyed by ackKey) move accepted findings aside, so an
 * intended setup (a media server's LAN port next to its domain) stops counting.
 */
export function exposureOf(s: ExposureInput, probes: Record<string, DomainProbe> = {}, acks: Record<string, ExposureAck> = {}): ServiceExposure {
  const where = s.host ? s.host : 'this machine'
  const ports: ExposurePort[] = s.ports.map((p) => ({ hostPort: p.hostPort, containerPort: p.containerPort, type: p.type, scope: portScope(p.addrs), addrs: p.addrs ?? [] }))
  const routes: ExposureRoute[] = s.domains.map((d) => {
    const probe = probes[d.url]
    const { access, signIn } = routeAccess(probe, d.domain)
    return { domain: d.domain, url: d.url, https: d.ssl, access, status: probe?.status ?? 0, ...(signIn ? { signIn } : {}), plainHttp: d.ssl ? plainHttpServed(probe?.http) : true }
  })
  const open = ports.filter((p) => p.scope === 'all')
  const role: ServiceExposure['role'] = s.isProxy ? 'proxy' : 'app'
  const findings: ExposureFinding[] = []

  if (role === 'proxy') {
    const admin = PROXY_ADMIN.find((a) => a.match.test(s.image))
    const port = admin && open.find((p) => p.containerPort === admin.port)
    if (admin && port) {
      findings.push({
        code: 'proxy-admin-open',
        level: admin.level,
        title: 'The proxy’s admin port is open on every interface',
        detail: `Port ${port.hostPort} on ${where} serves ${admin.what} to anything that can reach the machine. ${FIREWALL}`,
        fix: `Bind it to 127.0.0.1 (${bindExample(port)}) and reach it over an SSH tunnel, or give it a proxied domain with a login in front.`,
        snippet: localSnippet(port),
        ports: [port.hostPort],
      })
    }
  } else {
    // Only the port the proxy forwards to is a way around it. Another open port of the
    // same container is a different service (Wings' SFTP next to its API, a game port
    // next to a web panel): open, but not bypassing anything. Unknown forward port:
    // assume it is this one, the cautious reading.
    const forwarded = (p: ExposurePort) =>
      s.domains.some((d) => d.port === undefined || (d.via === 'ip' ? d.port === p.hostPort : d.port === p.containerPort))
    const bypass = routes.length ? open.filter(forwarded) : []
    const others = routes.length ? open.filter((p) => !forwarded(p)) : []
    if (bypass.length) {
      const gated = routes.some((r) => r.access === 'login' || r.access === 'sso' || r.access === 'refused')
      const byIp = s.domains.some((d) => d.via === 'ip')
      findings.push({
        code: 'around-proxy',
        level: 'risk',
        title: 'Reachable around the proxy',
        detail:
          `${list(routes.map((r) => r.domain))} ${routes.length === 1 ? 'goes' : 'go'} through the reverse proxy, but ${portsText(bypass)} ` +
          `${isAre(bypass)} also published on every interface of ${where}, which reaches the app directly, ` +
          `without the proxy’s HTTPS${gated ? ' or the login in front of it' : ''}. ${FIREWALL}`,
        fix: byIp
          ? 'The proxy reaches this app through the published port. Bind that port to the address the proxy connects from instead of every interface, or put the app on the proxy’s network and route to it by container name.'
          : `The proxy reaches it by container name, so the domain doesn’t need the port: remove it from \`ports:\`, or bind it to 127.0.0.1 (${bindExample(bypass[0])}) to keep local access.`,
        // binding to loopback would cut off a proxy that connects through the port
        ...(byIp ? {} : { snippet: localSnippet(bypass[0]) }),
        ports: hostPorts(bypass),
      })
    }
    if (others.length && !s.dockerSocket) {
      findings.push({
        code: 'open-port',
        level: 'open',
        title: 'Another port is open on every interface',
        detail: `${cap(portsText(others))} on ${where} ${isAre(others)} published on every interface. It isn’t the port the proxy forwards to, so it is a separate way in (often on purpose: SFTP, a game or media port). ${FIREWALL}`,
        fix: `Fine if it is meant to be reached directly. Otherwise bind it to 127.0.0.1 (${bindExample(others[0])}).`,
        snippet: localSnippet(others[0]),
        ports: hostPorts(others),
      })
    }
    if (s.dockerSocket && (routes.length || open.length)) {
      const how = [routes.length ? `at ${list(routes.map((r) => r.domain))}` : '', open.length ? `on ${portsText(open)} of every interface` : ''].filter(Boolean).join(' and ')
      findings.push({
        code: 'docker-control',
        level: 'risk',
        title: 'Controls Docker and is reachable',
        detail: `It mounts the Docker socket, so whoever gets into it can start containers as root on ${where}. It answers ${how}.`,
        fix: 'Keep it off the open internet: no published port, and a domain only with a login in front (an access list or forward-auth). If it only needs to read Docker, give it a socket proxy that allows reads only.',
        ...(open.length && !routes.length ? { snippet: localSnippet(open[0]) } : {}),
        ports: hostPorts(open),
      })
    }
    // the Docker finding above already covers its open port: one finding, not two
    if (!routes.length && open.length && !s.dockerSocket) {
      if (DATA_STORE.test(s.image.split('@')[0])) {
        findings.push({
          code: 'database-open',
          level: 'warn',
          title: 'A database is open on every interface',
          detail: `${cap(portsText(open))} on ${where} ${hostPorts(open).length === 1 ? 'reaches' : 'reach'} it directly. Databases are rarely meant to be reached from outside. ${FIREWALL}`,
          fix: `If only other containers use it, drop the port: they reach it by name on a shared network. If something on the host needs it, bind it to 127.0.0.1 (${bindExample(open[0])}).`,
          snippet: localSnippet(open[0]),
          ports: hostPorts(open),
        })
      } else {
        findings.push({
          code: 'open-port',
          level: 'open',
          title: 'Open on every interface',
          detail: `${cap(portsText(open))} on ${where} ${hostPorts(open).length === 1 ? 'reaches' : 'reach'} it directly, from anywhere that can reach the machine. ${FIREWALL}`,
          fix: `Fine for something meant to be reached directly, like a game server. Otherwise bind it to 127.0.0.1 (${bindExample(open[0])}) or put it behind the proxy.`,
          snippet: localSnippet(open[0]),
          ports: hostPorts(open),
        })
      }
    }
  }

  const plain = routes.filter((r) => !r.https)
  if (plain.length) {
    findings.push({
      code: 'plain-http',
      level: 'warn',
      title: 'Served without HTTPS',
      detail: `${list(plain.map((r) => r.domain))} ${plain.length === 1 ? 'has' : 'have'} no certificate, so passwords and cookies cross the network readable to anyone on the way.`,
      fix: 'Request a certificate for the route in the reverse proxy and turn on its HTTP to HTTPS redirect (Force SSL in Nginx Proxy Manager).',
    })
  }
  const leaky = routes.filter((r) => r.https && r.plainHttp === true)
  if (leaky.length) {
    findings.push({
      code: 'http-not-redirected',
      level: 'warn',
      title: 'Plain HTTP still works',
      detail: `${list(leaky.map((r) => r.domain))} ${leaky.length === 1 ? 'has' : 'have'} HTTPS, but http:// serves the app too instead of redirecting, so a link or a typed address without https:// sends logins in plain text.`,
      fix: 'Turn on the HTTP to HTTPS redirect for the route: Force SSL in Nginx Proxy Manager, a redirectScheme middleware in Traefik (Caddy redirects by default).',
    })
  }

  const active: ExposureFinding[] = []
  const accepted: ServiceExposure['accepted'] = []
  for (const f of findings) {
    const ack = acks[ackKey(s.key, f.code)]
    if (ack) accepted.push({ ...f, ...ack })
    else active.push(f)
  }
  active.sort((a, b) => RANK[a.level] - RANK[b.level])
  // without open findings (none, or all accepted) a container reads as what it is underneath
  const base: ExposureLevel = routes.length || (role === 'proxy' && open.length) ? 'proxied' : open.length ? 'open' : 'internal'
  const level: ExposureLevel = active[0]?.level ?? base
  return { id: s.id, key: s.key, name: s.name, image: s.image, ...(s.host ? { host: s.host } : {}), role, level, routes, ports, findings: active, accepted, dockerSocket: !!s.dockerSocket }
}

/** Highest level first, then by name. */
export function sortExposure(list: ServiceExposure[]): ServiceExposure[] {
  return [...list].sort((a, b) => RANK[a.level] - RANK[b.level] || a.name.localeCompare(b.name))
}

/** How many containers sit at each level. */
export function exposureSummary(list: ServiceExposure[]): Record<ExposureLevel, number> {
  const out: Record<ExposureLevel, number> = { risk: 0, warn: 0, open: 0, proxied: 0, internal: 0 }
  for (const e of list) out[e.level]++
  return out
}
