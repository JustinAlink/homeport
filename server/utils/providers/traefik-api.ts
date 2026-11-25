import type { DomainProvider, Route } from './types'

// Traefik's API (/api/http/routers + /api/http/services) as a domain source. It is
// the runtime view Traefik itself routes by, so one read covers every Traefik
// provider at once (Docker labels, file, Kubernetes CRD/Ingress, Consul, ...),
// where the label and file readers each see one of them. Read-only: homeport
// never writes routes through this API (Traefik's API has no write side).
//
// Shapes (pkg/api/handler_http.go): a router is its dynamic config plus
// `name`/`provider`/`status`; a service likewise, with loadBalancer.servers[].url.
// Names carry the provider (`whoami@docker`); a router's `service` omits it when
// the service lives in the router's own provider. Lists are paginated: 100 per
// page by default, X-Next-Page holds the next page (1 = there is none).

export interface TraefikApiRouter {
  name?: string
  provider?: string
  rule?: string
  service?: string
  tls?: unknown
  status?: string
  entryPoints?: string[]
}

export interface TraefikApiService {
  name?: string
  provider?: string
  status?: string
  loadBalancer?: { servers?: { url?: string }[] }
  weighted?: { services?: { name?: string }[] }
  mirroring?: { service?: string }
  failover?: { service?: string }
}

export const TRAEFIK_API_SOURCE = 'Traefik (API)'

/**
 * Host(`a.com`) || Host(`b.com`), and the v2 forms Host(`a.com`, `b.com`) and
 * HostHeader(...), give hostnames. HostRegexp and negated !Host(...) are not
 * domains anyone can open, so they are skipped.
 */
export function hostsFromRule(rule: string): string[] {
  const out: string[] = []
  for (const m of rule.matchAll(/(!\s*)?\bHost(?:Header)?\(([^)]*)\)/g)) {
    if (m[1]) continue
    for (const q of m[2].matchAll(/[`'"]([^`'"]+)[`'"]/g)) {
      const h = q[1].trim().toLowerCase()
      if (h && !/[{}*\s]/.test(h)) out.push(h)
    }
  }
  return [...new Set(out)]
}

// `whoami` from a router of the docker provider means `whoami@docker`
const qualify = (svc: string, provider?: string) => (svc.includes('@') || !provider ? svc : `${svc}@${provider}`)

/** http://172.18.0.3:80 or http://[fd00::3]:80 or h2c://app → host + port (default by scheme) */
export function upstreamOf(url: string): { host: string; port: number } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host) return null
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
  return { host, port }
}

/** Every upstream a service ends at: all load-balancer servers (replicas), through weighted/mirroring/failover. */
function upstreamsOf(name: string, byName: Map<string, TraefikApiService>, depth = 0): { host: string; port: number }[] {
  const svc = byName.get(name)
  if (!svc || depth > 5) return []
  if (svc.provider === 'internal' || name.endsWith('@internal')) return [] // api@internal, noop@internal, dashboard
  const out: { host: string; port: number }[] = []
  for (const s of svc.loadBalancer?.servers ?? []) {
    const up = s?.url ? upstreamOf(s.url) : null
    if (up) out.push(up)
  }
  // a weighted (canary) split serves the domain from every branch; a mirror or a
  // failover is served by its main service
  const next = [
    ...(svc.weighted?.services ?? []).map((w) => w?.name),
    svc.mirroring?.service,
    svc.failover?.service,
  ].filter((n): n is string => !!n)
  for (const n of next) out.push(...upstreamsOf(qualify(n, svc.provider), byName, depth + 1))
  return out
}

/**
 * Routers + services from the API into routes. Pure, exported for tests.
 * The common pair of an HTTP router that only redirects and an HTTPS router for
 * the same host and service merges into one HTTPS domain.
 */
export function parseTraefikApi(routers: TraefikApiRouter[], services: TraefikApiService[]): Route[] {
  const byName = new Map<string, TraefikApiService>()
  for (const s of services) if (s?.name) byName.set(s.name, s)

  // upstream key → domain → ssl (true wins)
  const merged = new Map<string, { host: string; port: number; domains: Map<string, boolean> }>()
  for (const r of routers) {
    if (!r || r.status === 'disabled') continue
    const domains = hostsFromRule(String(r.rule || ''))
    if (!domains.length || !r.service) continue
    const ssl = r.tls !== undefined && r.tls !== null && r.tls !== false
    for (const up of upstreamsOf(qualify(r.service, r.provider), byName)) {
      const key = `${up.host}|${up.port}`
      const entry = merged.get(key) ?? { ...up, domains: new Map<string, boolean>() }
      for (const d of domains) entry.domains.set(d, ssl || !!entry.domains.get(d))
      merged.set(key, entry)
    }
  }

  const routes: Route[] = []
  for (const e of merged.values()) {
    for (const ssl of [true, false]) {
      const domains = [...e.domains].filter(([, s]) => s === ssl).map(([d]) => d)
      if (domains.length) routes.push({ domains, upstreamHost: e.host, upstreamPort: e.port, ssl, source: TRAEFIK_API_SOURCE })
    }
  }
  return routes
}

/** Base URL without credentials or a trailing /api, plus the credentials it carried. */
export function apiBase(raw: string): { base: string; user: string; password: string } | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const user = decodeURIComponent(u.username)
  const password = decodeURIComponent(u.password)
  u.username = ''
  u.password = ''
  u.search = ''
  u.hash = ''
  const base = u.toString().replace(/\/+$/, '').replace(/\/api$/, '')
  return { base, user, password }
}

/** X-Next-Page is the next page, or 1 when this was the last one. */
export const nextPage = (header: string | null, page: number): number | null => {
  const n = Number(header)
  return Number.isInteger(n) && n > page ? n : null
}

export interface TraefikApiAuth {
  user?: string
  password?: string
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const PER_PAGE = 500
const MAX_PAGES = 40 // 20k routers: past that something is wrong, not a homelab

async function getAll<T>(base: string, path: string, headers: Record<string, string>, fetchImpl: FetchLike): Promise<T[]> {
  const out: T[] = []
  let page: number | null = 1
  for (let i = 0; page && i < MAX_PAGES; i++) {
    let res: Response
    try {
      // redirect: manual, so the basic-auth header never follows a redirect elsewhere
      res = await fetchImpl(`${base}${path}?per_page=${PER_PAGE}&page=${page}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(5000) })
    } catch (e: any) {
      const why = e?.name === 'TimeoutError' ? 'no answer within 5 s' : e?.cause?.code || e?.message || 'unreachable'
      throw new Error(`could not reach the Traefik API at ${base} (${why})`)
    }
    if (res.status >= 300 && res.status < 400) throw new Error(`the Traefik API redirected to ${res.headers.get('location') || 'another address'}: use that URL instead`)
    if (res.status === 401 || res.status === 403) throw new Error(`the Traefik API refused the login (HTTP ${res.status})`)
    if (res.status === 404) throw new Error(`no Traefik API at ${base} (HTTP 404): is the API enabled, and is this its entrypoint?`)
    if (!res.ok) throw new Error(`the Traefik API answered HTTP ${res.status}`)
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new Error(`${base} did not answer with Traefik API JSON`)
    }
    if (!Array.isArray(body)) throw new Error(`${base} did not answer with Traefik API JSON`)
    out.push(...(body as T[]))
    page = nextPage(res.headers.get('x-next-page'), page)
  }
  return out
}

/** Read routers + services. Throws a readable message (never containing the password). */
export async function fetchTraefikApi(url: string, auth: TraefikApiAuth = {}, fetchImpl: FetchLike = fetch): Promise<{ routers: TraefikApiRouter[]; services: TraefikApiService[] }> {
  const b = apiBase(url)
  if (!b) throw new Error('the Traefik API URL must be http(s)://')
  const user = auth.user || b.user
  const password = auth.password || b.password
  const headers: Record<string, string> = { accept: 'application/json' }
  if (user || password) headers.authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
  const [routers, services] = await Promise.all([
    getAll<TraefikApiRouter>(b.base, '/api/http/routers', headers, fetchImpl),
    getAll<TraefikApiService>(b.base, '/api/http/services', headers, fetchImpl),
  ])
  return { routers, services }
}

export function createTraefikApiProvider(url: string, auth: TraefikApiAuth = {}): DomainProvider {
  return {
    name: TRAEFIK_API_SOURCE,
    async getRoutes(): Promise<Route[]> {
      const { routers, services } = await fetchTraefikApi(url, auth)
      return parseTraefikApi(routers, services)
    },
  }
}
