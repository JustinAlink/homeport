import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DomainProvider, Route } from './types'

// Plain Nginx reverse-proxy configs (hand-written, SWAG, sites-enabled, …) — as
// opposed to NPM's generated `set $server` format. Parses `server { … }` blocks:
//   server_name a.com b.com;
//   listen 443 ssl;                       # presence => ssl
//   location / { proxy_pass http://app:8080; }
// `proxy_pass` may point at an `upstream { server host:port; }` block, which we resolve.
// Pure parser exported for unit testing.

interface NginxBlock {
  keyword: string
  name: string
  body: string
}

// Split a config into top-level brace blocks, labelled by the directive that opens them.
function topLevelBlocks(text: string): NginxBlock[] {
  const out: NginxBlock[] = []
  let depth = 0
  let bodyStart = 0
  let labelStart = 0
  let label = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      if (depth === 0) {
        label = text.slice(labelStart, i)
        bodyStart = i + 1
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        const opener = label.split(';').pop()!.trim() // ignore preceding simple directives
        const parts = opener.split(/\s+/).filter(Boolean)
        out.push({ keyword: parts[0] || '', name: parts[1] || '', body: text.slice(bodyStart, i) })
        labelStart = i + 1
      }
    }
  }
  return out
}

const stripComments = (txt: string) => txt.replace(/#[^\n]*/g, '')

export function parseNginxConf(txt: string): Route[] {
  const clean = stripComments(txt)
  const blocks = topLevelBlocks(clean)

  // upstream <name> { server host:port; } → name maps to that host:port
  const upstreams: Record<string, string> = {}
  for (const b of blocks) {
    if (b.keyword === 'upstream' && b.name) {
      const srv = b.body.match(/server\s+([^;\s]+)/)?.[1]
      if (srv) upstreams[b.name] = srv
    }
  }

  const routes: Route[] = []
  for (const b of blocks) {
    if (b.keyword !== 'server') continue

    const nameLine = b.body.match(/server_name\s+([^;]+);/)?.[1]
    const proxyPass = b.body.match(/proxy_pass\s+(https?:\/\/[^;\s]+)/)?.[1]
    if (!nameLine || !proxyPass) continue

    const domains = nameLine
      .trim()
      .split(/\s+/)
      .filter((d) => d && d !== '_' && d !== 'default_server' && !d.startsWith('$'))
    if (!domains.length) continue

    const m = proxyPass.match(/^(https?):\/\/([^/\s;]+)/)
    if (!m) continue
    const scheme = m[1]
    let [uhost, uport] = m[2].split(':')
    if (upstreams[uhost]) {
      const parts = upstreams[uhost].split(':')
      uhost = parts[0]
      uport = parts[1]
    }
    const port = Number(uport) || (scheme === 'https' ? 443 : 80)
    const ssl = /listen[^;]*\sssl/i.test(b.body) || /listen\s+443\b/.test(b.body)

    routes.push({ domains, upstreamHost: uhost, upstreamPort: port, ssl })
  }
  return routes
}

export function createNginxProvider(confPath: string): DomainProvider {
  return {
    name: 'Nginx',
    async getRoutes(): Promise<Route[]> {
      const texts: string[] = []
      try {
        // a directory (sites-enabled / conf.d): read every file in it
        const entries = await readdir(confPath, { withFileTypes: true })
        for (const e of entries) {
          if (e.isFile()) {
            try {
              texts.push(await readFile(join(confPath, e.name), 'utf8'))
            } catch {
              // skip unreadable file
            }
          }
        }
      } catch {
        // not a directory — try it as a single file
        try {
          texts.push(await readFile(confPath, 'utf8'))
        } catch {
          return []
        }
      }
      const routes: Route[] = []
      for (const t of texts) {
        try {
          routes.push(...parseNginxConf(t))
        } catch {
          // ignore unparseable conf
        }
      }
      return routes
    },
  }
}
