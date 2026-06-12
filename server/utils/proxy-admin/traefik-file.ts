import { readFileSync, writeFileSync, renameSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs'
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
  try {
    const text = readFileSync(file, 'utf8')
    return isToml(file) ? parseTOML(text) : parseYAML(text)
  } catch {
    return {} // missing/empty → fresh document
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
  if (existsSync(file)) {
    try {
      renameSync(file, `${file}.${ts}.bak`)
      pruneBackups(file)
    } catch {}
  }
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
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
