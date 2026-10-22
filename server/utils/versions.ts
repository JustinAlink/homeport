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

/** Every tag the registry lists for an image's repository. Throws when it can't be read. */
export async function listTags(image: string, creds?: RegistryCred[]): Promise<string[]> {
  const ref = parseImageRef(image)
  const host = ref.registry === 'docker.io' ? 'registry-1.docker.io' : ref.registry
  let url: string | undefined = `https://${host}/v2/${ref.repo}/tags/list?n=1000`
  let auth: string | undefined
  const tags: string[] = []
  for (let page = 0; url && page < MAX_PAGES; page++) {
    let r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: auth ? { authorization: auth } : {} })
    if (r.status === 401 && !auth) {
      auth = await tokenFor(r.headers.get('www-authenticate'), ref.repo, basicFor(ref.registry, creds))
      if (!auth) throw new Error(`${host} wants a login to list tags`)
      r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { authorization: auth } })
    }
    if (!r.ok) throw new Error(`${host} answered ${r.status}`)
    const j: any = await r.json()
    if (Array.isArray(j?.tags)) tags.push(...j.tags.filter((t: unknown) => typeof t === 'string'))
    url = nextPageUrl(r.headers.get('link'), url)
  }
  return tags
}
