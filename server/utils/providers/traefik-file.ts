import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseYAML } from 'confbox/yaml'
import { parseTOML } from 'confbox/toml'
import type { DomainProvider, Route } from './types'

// Traefik's *file* provider (dynamic config as YAML/TOML), as opposed to the
// label-based provider (traefik.ts). Reads http.routers + http.services:
//   http: { routers: { web: { rule: "Host(`app.example.com`)", service: "app", tls: {} } },
//           services: { app: { loadBalancer: { servers: [{ url: "http://app:8080" }] } } } }
// Pure parser exported for unit testing (confbox is a package import, so it stays
// resolvable in the node test runner).

export type TraefikFileFormat = 'yaml' | 'toml'

// Host(`a.com`, `b.com`) → ['a.com','b.com'] (mirrors traefik.ts label parsing).
function hostsFromRule(rule: string): string[] {
  const out: string[] = []
  for (const host of rule.matchAll(/Host\(([^)]*)\)/g)) {
    for (const q of host[1].matchAll(/[`'"]([^`'"]+)[`'"]/g)) out.push(q[1])
  }
  return out
}

export function parseTraefikFile(text: string, format: TraefikFileFormat): Route[] {
  let doc: any
  try {
    doc = format === 'toml' ? parseTOML(text) : parseYAML(text)
  } catch {
    return []
  }
  const http = doc?.http
  if (!http) return []
  const routers: Record<string, any> = http.routers || {}
  const services: Record<string, any> = http.services || {}

  const routes: Route[] = []
  for (const r of Object.values(routers)) {
    const domains = hostsFromRule(String(r?.rule || ''))
    if (!domains.length) continue

    let ssl = !!r?.tls
    const eps = r?.entryPoints || r?.entrypoints
    if (Array.isArray(eps) && eps.some((e: string) => /websecure|https/i.test(String(e)))) ssl = true

    // resolve the router's service → first loadBalancer server url
    let host = String(r?.service || '')
    let port = ssl ? 443 : 80
    const svc = services[host]
    const servers = svc?.loadBalancer?.servers || svc?.loadbalancer?.servers
    const url = Array.isArray(servers) ? servers[0]?.url : undefined
    if (url) {
      const m = String(url).match(/^(https?):\/\/([^/\s]+)/)
      if (m) {
        const [h, p] = m[2].split(':')
        host = h
        port = Number(p) || (m[1] === 'https' ? 443 : 80)
      }
    }

    routes.push({ domains: [...new Set(domains)], upstreamHost: host, upstreamPort: port, ssl })
  }
  return routes
}

const formatOf = (name: string): TraefikFileFormat => (/\.toml$/i.test(name) ? 'toml' : 'yaml')

export function createTraefikFileProvider(path: string): DomainProvider {
  return {
    name: 'Traefik (file)',
    async getRoutes(): Promise<Route[]> {
      const files: { text: string; fmt: TraefikFileFormat }[] = []
      try {
        // a directory of dynamic-config files
        const entries = await readdir(path, { withFileTypes: true })
        for (const e of entries) {
          if (e.isFile() && /\.(ya?ml|toml)$/i.test(e.name)) {
            try {
              files.push({ text: await readFile(join(path, e.name), 'utf8'), fmt: formatOf(e.name) })
            } catch {
              // skip unreadable file
            }
          }
        }
      } catch {
        // a single file
        try {
          files.push({ text: await readFile(path, 'utf8'), fmt: formatOf(path) })
        } catch {
          return []
        }
      }
      const routes: Route[] = []
      for (const f of files) {
        try {
          routes.push(...parseTraefikFile(f.text, f.fmt))
        } catch {
          // ignore unparseable file
        }
      }
      return routes
    },
  }
}
