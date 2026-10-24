/**
 * Best-effort "same app" key for a container image reference: the repo path with
 * the tag, digest, registry host, and docker's implicit `library/` stripped. So
 * `lscr.io/linuxserver/sonarr:4.0.9`, `linuxserver/sonarr`, and
 * `docker.io/linuxserver/sonarr` all reduce to `linuxserver/sonarr`, and
 * `library/ghost` / `ghost:5` reduce to `ghost`. Used to tell whether a catalog
 * app is already running here — a heuristic, not an identity.
 */
export function imageRepo(img: string): string {
  let s = (img || '').trim()
  const at = s.indexOf('@')
  if (at >= 0) s = s.slice(0, at) // drop @sha256:… digest
  const colon = s.lastIndexOf(':')
  if (colon > s.lastIndexOf('/')) s = s.slice(0, colon) // drop :tag (not a registry port)

  // drop a leading registry host (first segment that looks like a hostname)
  const slash = s.indexOf('/')
  if (slash > 0) {
    const first = s.slice(0, slash)
    if (first.includes('.') || first.includes(':') || first === 'localhost') s = s.slice(slash + 1)
  }
  if (s.startsWith('library/')) s = s.slice('library/'.length)
  return s
}

/** The tag of an image reference (`latest` when none is written). */
export function imageTag(img: string): string {
  let s = (img || '').trim()
  const at = s.indexOf('@')
  if (at >= 0) s = s.slice(0, at)
  const colon = s.lastIndexOf(':')
  return colon > s.lastIndexOf('/') ? s.slice(colon + 1) || 'latest' : 'latest'
}

/**
 * The image reference to paste for a version: `repo:tag`, plus `@sha256:…` when
 * the digest is known (a tag+digest pin stays one). Registry and repo as written.
 */
export function pinFor(image: string, tag: string, digest?: string): string {
  let base = (image || '').trim()
  const at = base.indexOf('@')
  if (at >= 0) base = base.slice(0, at)
  const colon = base.lastIndexOf(':')
  if (colon > base.lastIndexOf('/')) base = base.slice(0, colon)
  return `${base}:${tag}${digest ? `@${digest}` : ''}`
}
