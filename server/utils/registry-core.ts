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

/**
 * A bare image *ID* — the container's image lost its repo:tag (e.g. `docker pull`
 * replaced `:latest` and the old tag was pruned), so the daemon reports it as a
 * plain digest. There's no repository to query, so it can't be update-checked;
 * the daemon 500s with "no manifest found for full image ID". Treat as local.
 */
export function isBareImageId(image: string): boolean {
  return /^(sha256:)?[0-9a-f]{64}$/.test(image.trim())
}

/** Does any local RepoDigest match the registry's current digest for this repo? */
export function digestMatches(repoDigests: string[] | undefined, remoteDigest: string): boolean {
  if (!repoDigests?.length || !remoteDigest) return false
  return repoDigests.some((d) => {
    const at = d.indexOf('@')
    return at >= 0 && d.slice(at + 1) === remoteDigest
  })
}

/** A stored login for one registry host, used to check/pull private images. */
export interface RegistryCred {
  registry: string // host as the daemon sees it: ghcr.io, docker.io, registry.example.com:5000
  username: string
  token: string // password or personal-access-token
}

/** dockerode `authconfig` shape — base64'd into the X-Registry-Auth header. */
export interface DockerAuthConfig {
  username: string
  password: string
  serveraddress: string
}

/** Canonicalise a registry host so a cred matches parseImageRef()'s `registry`. */
export function normalizeRegistry(input: string): string {
  const r = (input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!r || r === 'index.docker.io' || r === 'registry-1.docker.io' || r === 'docker.io' || r === 'hub.docker.com')
    return 'docker.io'
  return r
}

/**
 * Keep-existing merge for masked tokens. `settings.get` masks stored tokens to '',
 * so a save round-trips blank tokens — reuse the existing token (matched by registry,
 * and username when the incoming cred names one) instead of wiping it. Creds still
 * without a token after the merge are dropped (an empty row = "remove this login").
 */
export function mergeRegistryCredSecrets(incoming: RegistryCred[], existing: RegistryCred[]): RegistryCred[] {
  return incoming
    .map((c) => {
      if (c.token) return c
      const prior = existing.find(
        (e) => normalizeRegistry(e.registry) === normalizeRegistry(c.registry) && (!c.username || e.username === c.username),
      )
      return prior?.token ? { ...c, token: prior.token } : c
    })
    .filter((c) => c.registry && c.token)
}

/** The dockerode authconfig for an image, or undefined when no cred matches. */
export function authForImage(image: string, creds: RegistryCred[] | undefined): DockerAuthConfig | undefined {
  if (!creds?.length) return undefined
  const { registry } = parseImageRef(image)
  const cred = creds.find((c) => normalizeRegistry(c.registry) === registry)
  if (!cred?.token) return undefined
  return {
    username: cred.username || '',
    password: cred.token,
    serveraddress: registry === 'docker.io' ? 'https://index.docker.io/v1/' : registry,
  }
}

export type UpdateStatus = 'current' | 'update' | 'local' | 'pinned' | 'error'

export interface UpdateEntry {
  status: UpdateStatus
  localDigest?: string
  remoteDigest?: string
  checkedAt: number
  error?: string
  /** Last remoteDigest an "update available" notification went out for. */
  notifiedDigest?: string
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
