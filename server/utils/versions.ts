// Registry tag listing for the "newer version" check (pure logic in versions-core.ts).
// Unlike the digest check, which the daemon does for us, the tag list has no daemon
// endpoint, so this talks to the registry's v2 API directly: anonymous pull token
// from whatever realm the registry's 401 names (Docker Hub, GHCR, lscr.io, quay.io
// all work this way), or the stored login for that registry when there is one.
// Best-effort throughout: any failure just means "no newer-version info".

import { parseImageRef, normalizeRegistry, type RegistryCred } from './registry-core'
import { parseWwwAuthenticate, nextPageUrl } from './versions-core'

const MAX_PAGES = 30 // jellyfin alone lists ~14k tags; a bigger list is cut short, not fatal
const TIMEOUT_MS = 10_000

function basicFor(registry: string, creds: RegistryCred[] | undefined): string | undefined {
  const c = creds?.find((x) => normalizeRegistry(x.registry) === registry && x.token)
  return c ? `Basic ${Buffer.from(`${c.username || ''}:${c.token}`).toString('base64')}` : undefined
}

async function tokenFor(challenge: string | null, repo: string, basic: string | undefined): Promise<string | undefined> {
  const ch = parseWwwAuthenticate(challenge)
  if (!ch) return undefined
  if (ch.scheme === 'basic') return basic
  if (ch.scheme !== 'bearer' || !ch.params.realm) return undefined
  const u = new URL(ch.params.realm)
  if (ch.params.service) u.searchParams.set('service', ch.params.service)
  u.searchParams.set('scope', `repository:${repo}:pull`)
  const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: basic ? { authorization: basic } : {} })
  if (!r.ok) return undefined
  const j: any = await r.json()
  const tok = j?.token || j?.access_token
  return tok ? `Bearer ${tok}` : undefined
}

const registryHost = (registry: string) => (registry === 'docker.io' ? 'registry-1.docker.io' : registry)

/** One registry request, with the 401 → pull-token → retry dance; `auth` carries the token between calls. */
async function registryFetch(
  url: string,
  ref: { registry: string; repo: string },
  creds: RegistryCred[] | undefined,
  state: { auth?: string },
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const go = () => fetch(url, { method: init.method, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { ...init.headers, ...(state.auth ? { authorization: state.auth } : {}) } })
  let r = await go()
  if (r.status === 401 && !state.auth) {
    state.auth = await tokenFor(r.headers.get('www-authenticate'), ref.repo, basicFor(ref.registry, creds))
    if (!state.auth) throw new Error(`${registryHost(ref.registry)} wants a login`)
    r = await go()
  }
  return r
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

/**
 * The digest a tag points at right now, the same value a `image:tag@sha256:...` pin
 * holds (the multi-arch index for multi-arch images). A HEAD request: registries
 * answer with Docker-Content-Digest, and Docker Hub doesn't count it as a pull.
 */
export async function tagDigest(image: string, tag: string, creds?: RegistryCred[]): Promise<string | null> {
  const ref = parseImageRef(image)
  const r = await registryFetch(`https://${registryHost(ref.registry)}/v2/${ref.repo}/manifests/${encodeURIComponent(tag)}`, ref, creds, {}, {
    method: 'HEAD',
    headers: { accept: MANIFEST_ACCEPT },
  })
  const digest = r.ok ? r.headers.get('docker-content-digest') : null
  return digest && /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : null
}

/** Every tag the registry lists for an image's repository. Throws when it can't be read. */
export async function listTags(image: string, creds?: RegistryCred[]): Promise<string[]> {
  const ref = parseImageRef(image)
  const host = registryHost(ref.registry)
  let url: string | undefined = `https://${host}/v2/${ref.repo}/tags/list?n=1000`
  const state: { auth?: string } = {}
  const tags: string[] = []
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const r = await registryFetch(url, ref, creds, state)
    if (!r.ok) throw new Error(`${host} answered ${r.status}`)
    const j: any = await r.json()
    if (Array.isArray(j?.tags)) tags.push(...j.tags.filter((t: unknown) => typeof t === 'string'))
    url = nextPageUrl(r.headers.get('link'), url)
  }
  return tags
}
