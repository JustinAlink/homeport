// Pure, dependency-free image-reference + update-check logic — unit-testable in isolation.

export interface ImageRef {
  registry: string // e.g. docker.io, ghcr.io, registry.example.com:5000
  repo: string // e.g. library/nginx, user/app
  tag: string // e.g. latest, 1.2.3
  digestPinned: boolean // image@sha256:… refs can never "update"
}

/**
 * Parse a docker image reference the way the daemon does:
 *   nginx → docker.io/library/nginx:latest
 *   user/app:1.2 → docker.io/user/app:1.2
 *   ghcr.io/owner/app → ghcr.io/owner/app:latest
 *   registry:5000/app → registry:5000/app:latest (port ≠ tag)
 *   app@sha256:… → digest-pinned
 */
export function parseImageRef(image: string): ImageRef {
  let rest = image.trim()
  let digestPinned = false

  const at = rest.indexOf('@')
  if (at >= 0) {
    digestPinned = true
    rest = rest.slice(0, at)
  }

  // registry host = first path segment iff it has a '.' or ':' (or is "localhost")
  let registry = 'docker.io'
  const slash = rest.indexOf('/')
  if (slash > 0) {
    const first = rest.slice(0, slash)
    if (first.includes('.') || first.includes(':') || first === 'localhost') {
      registry = first
      rest = rest.slice(slash + 1)
    }
  }

  // tag = after the last ':' iff that ':' comes after the last '/' (else it's a port)
  let tag = 'latest'
  const colon = rest.lastIndexOf(':')
  if (colon > rest.lastIndexOf('/')) {
    tag = rest.slice(colon + 1) || 'latest'
    rest = rest.slice(0, colon)
  }

  // Docker Hub shorthand: single-segment repos live under library/
  let repo = rest
  if (registry === 'docker.io' && !repo.includes('/')) repo = `library/${repo}`

  return { registry, repo, tag, digestPinned }
}

/** Does any local RepoDigest match the registry's current digest for this repo? */
export function digestMatches(repoDigests: string[] | undefined, remoteDigest: string): boolean {
  if (!repoDigests?.length || !remoteDigest) return false
  return repoDigests.some((d) => {
    const at = d.indexOf('@')
    return at >= 0 && d.slice(at + 1) === remoteDigest
  })
}

export type UpdateStatus = 'current' | 'update' | 'local' | 'pinned' | 'error'

export interface UpdateEntry {
  status: UpdateStatus
  localDigest?: string
  remoteDigest?: string
  checkedAt: number
  error?: string
}

/**
 * Pick which images are due a check this cycle: never checked, or checked longer
 * than intervalMs ago — oldest first, capped at batch to stagger registry load.
 */
export function pickDueChecks(
  images: string[],
  cache: Record<string, UpdateEntry | undefined>,
  now: number,
  intervalMs: number,
  batch: number,
): string[] {
  return images
    .filter((img) => {
      const e = cache[img]
      return !e || now - e.checkedAt >= intervalMs
    })
    .sort((a, b) => (cache[a]?.checkedAt ?? 0) - (cache[b]?.checkedAt ?? 0))
    .slice(0, Math.max(0, batch))
}
