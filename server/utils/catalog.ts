import { getConfig } from './config'
import { httpJson } from './http'
import { mergeApps, parseCatalogDocument, parseNativeCatalog, type CatalogApp } from './catalog-core'
import { BUILTIN_CATALOG } from './catalog-builtin'

// Catalog aggregation: built-in templates + user-configured source URLs
// (native or Portainer format, auto-detected). Fetched sources are cached
// in memory with a TTL — a restart just refetches.

export interface CatalogSourceStatus {
  url: string
  ok: boolean
  count: number
  /** Templates the source had that we can't run (e.g. Portainer git-stack types). */
  skipped: number
  format?: 'native' | 'portainer'
  error?: string
}

export interface CatalogResult {
  apps: CatalogApp[]
  sources: CatalogSourceStatus[]
  fetchedAt: number
}

const TTL_MS = 6 * 3600_000
let cache: CatalogResult | null = null
let cacheKey = ''

export async function getCatalog(refresh = false): Promise<CatalogResult> {
  const cfg = getConfig()
  const key = cfg.catalogUrls.join('\n')
  if (!refresh && cache && cacheKey === key && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache
  }

  const builtin = parseNativeCatalog(BUILTIN_CATALOG, 'built-in')
  const lists: CatalogApp[][] = [builtin.apps]
  const sources: CatalogSourceStatus[] = [
    { url: 'built-in', ok: true, count: builtin.apps.length, skipped: builtin.skipped, format: 'native' },
  ]

  for (const url of cfg.catalogUrls) {
    const res = await httpJson(url, { timeoutMs: 15_000 })
    if (!res.ok || res.data === null) {
      sources.push({ url, ok: false, count: 0, skipped: 0, error: res.error || 'response is not JSON' })
      continue
    }
    const parsed = parseCatalogDocument(res.data, url)
    lists.push(parsed.apps)
    sources.push({ url, ok: true, count: parsed.apps.length, skipped: parsed.skipped, format: parsed.format })
  }

  cache = { apps: mergeApps(lists), sources, fetchedAt: Date.now() }
  cacheKey = key
  return cache
}

export async function findApp(slug: string, refresh = false): Promise<CatalogApp | null> {
  const { apps } = await getCatalog(refresh)
  return apps.find((a) => a.slug === slug) ?? null
}
