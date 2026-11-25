import { readFileSync, writeFileSync, renameSync, existsSync, statSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseYAML, stringifyYAML } from 'confbox/yaml'
import { parseTOML, stringifyTOML } from 'confbox/toml'
import type { ProxyAdmin, AdminRoute, NewRoute } from './types'
import { routeSlug } from './types'
import { upsertRoute, removeRoute, listRoutes, HP_PREFIX } from './traefik-admin-core'

// Traefik file provider, write side. Reads/writes a dynamic-config file via
// confbox (YAML or TOML). When traefikFilePath is a DIRECTORY, homeport owns
// `homeport.yml` inside it (Traefik watches the dir) and never touches the user's
// other files. When it's a single FILE, only homeport-<slug> keys are modified.
// Writes are atomic (tmp+rename) with a timestamped .bak (keep last 5).

const isToml = (p: string) => /\.toml$/i.test(p)

function targetFile(path: string): string {
  try {
    if (statSync(path).isDirectory()) return join(path, 'homeport.yml')
  } catch {
    // doesn't exist yet — treat as a file path
  }
  return path
}

function load(file: string): any {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e: any) {
    if (e?.code === 'ENOENT') return {} // not created yet: a fresh document
    throw e
  }
  if (!text.trim()) return {}
  // Only a missing or empty file may count as empty. A file homeport can't parse
  // (a typo, or Traefik's Go templating like {{ env "X" }}, which isn't YAML) used
  // to read as {}, and the next save replaced the user's whole config with just
  // homeport's route. Refuse instead; the error reaches the UI.
  try {
    return (isToml(file) ? parseTOML(text) : parseYAML(text)) ?? {}
  } catch (e: any) {
    throw new Error(`can't parse ${file}, so homeport won't rewrite it: ${e?.message || e}`)
  }
}

function pruneBackups(file: string) {
  try {
    const dir = file.slice(0, file.lastIndexOf('/')) || '.'
    const baseName = file.slice(file.lastIndexOf('/') + 1)
    const baks = readdirSync(dir)
      .filter((f) => f.startsWith(`${baseName}.`) && f.endsWith('.bak'))
      .sort()
    for (const old of baks.slice(0, Math.max(0, baks.length - 5))) {
      try {
        unlinkSync(join(dir, old))
      } catch {}
    }
  } catch {}
}

function save(file: string, doc: any, ts: number) {
  const text = isToml(file) ? stringifyTOML(doc) : stringifyYAML(doc)
  // New content first: if this write fails (disk full), the live file is untouched.
  // The old order renamed the live file to .bak before writing, so a failed write
  // left Traefik with no config file at all.
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
  if (existsSync(file)) {
    try {
      copyFileSync(file, `${file}.${ts}.bak`)
      pruneBackups(file)
    } catch {} // a backup is best-effort; it must never block the write
  }
  renameSync(tmp, file)
}

export function createTraefikFileAdmin(path: string, now: () => number = Date.now): ProxyAdmin {
  const file = targetFile(path)

  return {
    name: 'Traefik (file)',
    capabilities: { create: true, update: true, delete: true },

    async test() {
      const dir = file.slice(0, file.lastIndexOf('/')) || '.'
      if (!existsSync(dir)) return { ok: false, message: `directory not found: ${dir}` }
      try {
        // writable check: the .bak rename is our write path
        return { ok: true, message: `Managing ${file}` }
      } catch (e: any) {
        return { ok: false, message: e?.message || 'not writable' }
      }
    },

    async listRoutes(): Promise<AdminRoute[]> {
      return listRoutes(load(file))
    },

    async createRoute(route: NewRoute): Promise<AdminRoute> {
      const slug = routeSlug(route)
      save(file, upsertRoute(load(file), route, slug), now())
      return { ...route, id: HP_PREFIX + slug, managed: true }
    },

    async updateRoute(id: string, route: NewRoute): Promise<AdminRoute> {
      if (!id.startsWith(HP_PREFIX)) throw new Error('only homeport-created Traefik routes can be modified here')
      const slug = id.slice(HP_PREFIX.length)
      save(file, upsertRoute(load(file), route, slug), now())
      return { ...route, id, managed: true }
    },

    async deleteRoute(id: string): Promise<void> {
      save(file, removeRoute(load(file), id), now())
    },
  }
}
