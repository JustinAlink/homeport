import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DomainProvider, Route } from './types'

/**
 * Parse a single NPM generated proxy-host conf. Real format (verified):
 *   set $forward_scheme http;
 *   set $server  "webapp";   # OR a host IP like "172.17.0.1"
 *   set $port    80;
 *   server_name  app.example.com www.app.example.com;
 *   ssl_certificate ...                # presence => ssl
 * Exported for unit testing against fixtures.
 */
export function parseConf(txt: string): Route | null {
  const server = txt.match(/set\s+\$server\s+"?([^"\s;]+)"?\s*;/)?.[1]
  const port = txt.match(/set\s+\$port\s+(\d+)\s*;/)?.[1]
  const nameLine = txt.match(/server_name\s+([^;]+);/)?.[1]
  if (!server || !port || !nameLine) return null

  const domains = nameLine
    .trim()
    .split(/\s+/)
    .filter((d) => d && d !== '_' && !d.startsWith('$'))
  if (!domains.length) return null

  const ssl = /ssl_certificate\s/.test(txt) || /listen\s+443\s+ssl/.test(txt)
  return { domains, upstreamHost: server, upstreamPort: Number(port), ssl }
}

export function createNpmProvider(confDir: string): DomainProvider {
  return {
    name: 'Nginx Proxy Manager',
    async getRoutes(): Promise<Route[]> {
      let files: string[]
      try {
        files = (await readdir(confDir)).filter((f) => f.endsWith('.conf'))
      } catch {
        return [] // dir missing / unreadable — just no domains
      }
      const routes: Route[] = []
      for (const f of files) {
        try {
          const route = parseConf(await readFile(join(confDir, f), 'utf8'))
          if (route) routes.push(route)
        } catch {
          // ignore unparseable conf
        }
      }
      return routes
    },
  }
}
