import { readFile } from 'node:fs/promises'
import type { DomainProvider, Route } from './types'

const isDomain = (s: string) => /\./.test(s) && !/[`${}]/.test(s)

/**
 * Parse a Caddyfile into routes. Heuristic (handles the common cases, not the full
 * grammar). Pure — exported for tests.
 *   app.example.com {
 *       reverse_proxy myapp:8080
 *   }
 *   http://internal.example.com, foo.example.com {
 *       reverse_proxy { to backend:3000 }
 *   }
 */
export function parseCaddyfile(text: string): Route[] {
  const clean = text.replace(/^\s*#.*$/gm, '') // strip comments
  const routes: Route[] = []

  for (const block of clean.matchAll(/([^\n{}]+?)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    const addrLine = block[1].trim()
    const body = block[2]
    if (!addrLine || addrLine.startsWith('(')) continue // snippet / global block

    let ssl = true
    const domains: string[] = []
    for (let a of addrLine.split(/[,\s]+/).filter(Boolean)) {
      if (a.startsWith('http://')) {
        ssl = false
        a = a.slice(7)
      } else if (a.startsWith('https://')) {
        a = a.slice(8)
      }
      a = a.replace(/:\d+$/, '') // strip port
      if (isDomain(a)) domains.push(a)
    }

    // upstream: `reverse_proxy host:port` or a nested `... { to host:port }`
    const up = body.match(/reverse_proxy\s+([^\s\n{]+)/)?.[1] || body.match(/\bto\s+([^\s\n]+)/)?.[1]
    if (!domains.length || !up) continue

    const [host, p] = up.replace(/^https?:\/\//, '').split(':')
    routes.push({ domains: [...new Set(domains)], upstreamHost: host, upstreamPort: Number(p) || 80, ssl })
  }

  return routes
}

export function createCaddyProvider(caddyfilePath: string): DomainProvider {
  return {
    name: 'Caddy',
    async getRoutes(): Promise<Route[]> {
      try {
        return parseCaddyfile(await readFile(caddyfilePath, 'utf8'))
      } catch {
        return []
      }
    },
  }
}
