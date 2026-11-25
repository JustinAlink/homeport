import type { Route } from './types'

// caddy-docker-proxy (lucaslorentz/caddy-docker-proxy) builds its Caddyfile from
// container labels. Grammar, from its README:
//   caddy: a.example.com, b.example.com          a site block (addresses)
//   caddy.reverse_proxy: "{{upstreams 8080}}"     this container's IPs, port 8080
//   caddy_0: ... / caddy_1: ...                   several isolated sites on one container
//   caddy.handle_path.0_reverse_proxy: ...        nested; `0_` orders, `_0` isolates
//   {{upstreams}} / {{upstreams https 8443}} / {{upstreams lowestExposedPort}}
// `{{upstreams}}` resolves to the labelled container itself, so the route targets
// it by name. Pure, exported for tests. Swarm service labels are not read (homeport
// lists containers), and a custom CADDY_DOCKER_LABEL_PREFIX is not picked up.

export const CADDY_DOCKER_PROXY_SOURCE = 'caddy-docker-proxy'

export interface LabelledContainer {
  name: string
  labels: Record<string, string>
  internalPorts?: number[]
}

// strip the ordering prefix (0_reverse_proxy) and isolation suffix (route_0)
const directive = (seg: string) => seg.replace(/^\d+_/, '').replace(/_\d+$/, '')

/** The upstream a reverse_proxy value points at, or null. */
function upstreamFrom(value: string, c: LabelledContainer): { host: string; port: number } | null {
  const tpl = value.match(/\{\{\s*upstreams\b([^}]*)\}\}/)
  if (tpl) {
    const args = tpl[1].trim().split(/\s+/).filter(Boolean)
    const https = args.includes('https')
    const num = args.find((a) => /^\d+$/.test(a))
    let port = num ? Number(num) : https ? 443 : 80
    if (args.includes('lowestExposedPort')) port = c.internalPorts?.length ? Math.min(...c.internalPorts) : 0
    return { host: c.name, port }
  }
  // a literal upstream (another container or host); matchers come first: @ws, /api*, *
  const tok = value
    .split(/\s+/)
    .map((t) => t.replace(/^["'`]|["'`]$/g, ''))
    .find((t) => t && !/^[@/*{]/.test(t))
  if (!tok) return null
  const m = tok.replace(/^(https?|h2c):\/\//, '').match(/^(\[[^\]]+\]|[^:/]+)(?::(\d+))?/)
  if (!m) return null
  return { host: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2]) || (tok.startsWith('https://') ? 443 : 80) }
}

/** Site addresses into domains, split by whether Caddy serves them over HTTPS. */
function addresses(value: string): { https: string[]; http: string[] } {
  const out = { https: [] as string[], http: [] as string[] }
  for (let a of value.split(/[,\s]+/).filter(Boolean)) {
    let ssl = true
    if (a.startsWith('http://')) {
      ssl = false
      a = a.slice(7)
    } else if (a.startsWith('https://')) {
      a = a.slice(8)
    }
    const port = a.match(/:(\d+)$/)?.[1]
    if (port === '80') ssl = false
    a = a.replace(/:\d+$/, '').replace(/\/.*$/, '').toLowerCase()
    // snippets `(name)`, port-only `:8080`, wildcards and placeholders are not openable domains
    if (!a || !a.includes('.') || /[(){}*$`]/.test(a)) continue
    ;(ssl ? out.https : out.http).push(a)
  }
  return out
}

export function parseCaddyDockerProxyLabels(containers: LabelledContainer[], prefix = 'caddy'): Route[] {
  const routes: Route[] = []
  const siteKey = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_\\d+)?$`)
  for (const c of containers) {
    const keys = Object.keys(c.labels).sort()
    for (const site of keys.filter((k) => siteKey.test(k))) {
      const { https, http } = addresses(c.labels[site] || '')
      if (!https.length && !http.length) continue // a global-options block, or a snippet
      // `reverse_proxy <upstreams>` at any depth, or its block form `reverse_proxy.to`;
      // not `reverse_proxy.header_up` and other subdirectives
      let up: { host: string; port: number } | null = null
      for (const k of keys) {
        if (!k.startsWith(`${site}.`)) continue
        const path = k.slice(site.length + 1).split('.').map(directive)
        const last = path[path.length - 1]
        if (last === 'reverse_proxy' || (last === 'to' && path[path.length - 2] === 'reverse_proxy')) {
          up = upstreamFrom(c.labels[k] || '', c)
          if (up) break
        }
      }
      if (!up) continue
      for (const [ssl, domains] of [[true, https], [false, http]] as const) {
        if (domains.length) routes.push({ domains: [...new Set(domains)], upstreamHost: up.host, upstreamPort: up.port, ssl, source: CADDY_DOCKER_PROXY_SOURCE })
      }
    }
  }
  return routes
}
