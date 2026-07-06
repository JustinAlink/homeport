// Docker Hub / registry network layer: popular-image listing and image-config
// inspection (EXPOSEd ports + declared volumes) for the auto-dockerize flow.
// Pure logic lives in autostack-core.ts.

import { parseImageRef } from './registry-core'
import { imageMetaFromConfig, parseHubCount, pickManifestDigest, type ImageMeta } from './autostack-core'

export interface HubRepo {
  name: string
  description: string
  stars: number
  pulls: number
  official: boolean
}

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers })
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`)
  return r.json()
}

// --- top list -----------------------------------------------------------

let topCache: { at: number; repos: HubRepo[] } | null = null
const TOP_TTL_MS = 60 * 60_000

/** Most-pulled official images — Docker Hub's v4 search with an empty query. */
export async function hubTop(): Promise<HubRepo[]> {
  if (topCache && Date.now() - topCache.at < TOP_TTL_MS) return topCache.repos
  const j = await getJson(
    'https://hub.docker.com/api/search/v4?query=&size=12&sort=pull_count&order=desc&badges=official',
    { accept: 'application/json' },
  )
  const repos: HubRepo[] = ((j?.results ?? []) as any[])
    .map((o) => ({
      name: String(o.slug || o.name || ''),
      description: String(o.short_description || ''),
      stars: Number(o.star_count) || 0,
      pulls: parseHubCount(o.pull_count),
      official: o.badge === 'official',
    }))
    .filter((x) => x.name)
  topCache = { at: Date.now(), repos }
  return repos
}

// --- image inspection ----------------------------------------------------

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

const metaCache = new Map<string, { at: number; meta: ImageMeta }>()
const META_TTL_MS = 60 * 60_000

/**
 * Ports/volumes an image declares, read from its registry config blob
 * (anonymous pull token → manifest → config). Docker Hub images only —
 * that's all the Hub tab can produce.
 */
export async function inspectHubImage(image: string): Promise<ImageMeta> {
  const ref = parseImageRef(image)
  if (ref.registry !== 'docker.io') throw new Error('only Docker Hub images can be inspected here')

  const key = `${ref.repo}:${ref.tag}`
  const hit = metaCache.get(key)
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta

  const tok = await getJson(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${ref.repo}:pull`,
    { accept: 'application/json' },
  )
  const headers = { authorization: `Bearer ${tok?.token || ''}`, accept: MANIFEST_ACCEPT }

  let manifest = await getJson(`https://registry-1.docker.io/v2/${ref.repo}/manifests/${ref.tag}`, headers)
  if (Array.isArray(manifest?.manifests)) {
    const digest = pickManifestDigest(manifest)
    if (!digest) throw new Error('the image has no linux variant')
    manifest = await getJson(`https://registry-1.docker.io/v2/${ref.repo}/manifests/${digest}`, headers)
  }
  const cfgDigest = manifest?.config?.digest
  if (!cfgDigest) throw new Error('the registry returned no image config')

  const cfg = await getJson(`https://registry-1.docker.io/v2/${ref.repo}/blobs/${cfgDigest}`, headers)
  const meta = imageMetaFromConfig(cfg)

  if (metaCache.size > 200) metaCache.clear()
  metaCache.set(key, { at: Date.now(), meta })
  return meta
}
