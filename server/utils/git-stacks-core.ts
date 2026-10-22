// Pure logic for git-backed stacks — URL validation, auth header construction,
// token redaction, output parsing. No fs/exec — unit-testable in isolation.

/**
 * Accept only http(s) git remotes. ssh:// would need key management; tokens
 * ride an Authorization header instead (never embedded in the URL, so they
 * can't leak via .git/config, error messages, or the ops stream).
 */
export function validateRepoUrl(raw: string): string | null {
  const url = String(raw || '').trim()
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const u = new URL(url)
    if (u.username || u.password) return null // credentials belong in the token field
    if (!u.hostname) return null
    return u.toString()
  } catch {
    return null
  }
}

/** Branch/tag names come from user input and end up in argv — keep them tame. */
export function validateRef(raw: string): string | null {
  const ref = String(raw || '').trim()
  if (!ref) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(ref) || ref.includes('..')) return null
  return ref
}

/**
 * Authorization header for token access. `x-access-token:<token>` as basic
 * auth is accepted by GitHub, Gitea and Forgejo; GitLab wants `oauth2` as the
 * username — both are covered by trying x-access-token first, and GitLab PATs
 * also work as basic-auth passwords with any username.
 * Passed per-invocation via `git -c http.<url>.extraheader=…` so the token is
 * never written to .git/config.
 */
export function authHeader(token: string): string {
  const b64 = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  return `AUTHORIZATION: basic ${b64}`
}

/** git argv prefix that injects auth for this remote only (empty without token). */
export function authArgs(repoUrl: string, token: string | null): string[] {
  if (!token) return []
  let origin: string
  try {
    origin = new URL(repoUrl).origin
  } catch {
    return []
  }
  return ['-c', `http.${origin}/.extraheader=${authHeader(token)}`]
}

/**
 * Scrub anything token-shaped from streamed git output before it reaches the
 * ops log / SSE clients: the exact token, its base64 basic form, and
 * credentials git may echo inside URLs on failure.
 */
export function redactSecrets(line: string, token: string | null): string {
  let out = line.replace(/(https?:\/\/)[^\/\s@]+@/gi, '$1***@')
  if (token) {
    const b64 = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
    out = out.split(token).join('***').split(b64).join('***')
  }
  return out
}

export interface GitStackMeta {
  repo: string // remote URL (always credential-free by construction)
  branch: string
  commit: string // short hash
  subject: string
  committedAt: string // ISO-ish from git
  behind: boolean | null // null = remote not checked / unreachable
  remoteCommit?: string
  /** Files git tracks: an update from git (reset --hard) overwrites these, untracked ones survive. */
  tracked?: string[]
}

/** Parse `git log -1 --format=%h%x1f%s%x1f%cI` output. */
export function parseHeadLog(out: string): { commit: string; subject: string; committedAt: string } | null {
  const parts = out.trim().split('\x1f')
  if (parts.length !== 3 || !parts[0]) return null
  return { commit: parts[0], subject: parts[1], committedAt: parts[2] }
}

/** Parse `git ls-remote origin <ref>` → the remote head sha (null if absent). */
export function parseLsRemote(out: string): string | null {
  const sha = out.trim().split(/\s+/)[0]
  return /^[0-9a-f]{40}$/.test(sha || '') ? sha : null
}
