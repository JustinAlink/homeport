// Deploy on push: the bits both the stack page and the server need (pure, no
// imports), so the interval the card offers is the interval the server accepts.

/** Public delivery path for a stack's webhook: /api/hooks/git/<stack>/<id>. */
export const HOOK_PATH_PREFIX = '/api/hooks/git/'
export const hookPath = (stack: string, id: string) => `${HOOK_PATH_PREFIX}${encodeURIComponent(stack)}/${encodeURIComponent(id)}`

// Auto-sync asks the remote for one ref (git ls-remote) per interval. Two
// minutes is the floor: a forge rate-limits a tight poll, and a push that needs
// to land faster than that is what the webhook is for.
export const AUTO_SYNC_MIN = 2
export const AUTO_SYNC_MAX = 24 * 60
export const AUTO_SYNC_DEFAULT = 5
export const AUTO_SYNC_PRESETS = [2, 5, 15, 30, 60, 360, 1440] as const

/** A stored or submitted interval, forced into [min, max] whole minutes (default when not a number). */
export function clampSyncInterval(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return AUTO_SYNC_DEFAULT
  return Math.min(AUTO_SYNC_MAX, Math.max(AUTO_SYNC_MIN, Math.round(n)))
}

export function intervalLabel(min: number): string {
  if (min < 60) return `${min} min`
  const h = min / 60
  return Number.isInteger(h) ? `${h} hour${h === 1 ? '' : 's'}` : `${min} min`
}

/**
 * Why a hosted forge (github.com, gitlab.com) cannot deliver to this host, or
 * null when nothing says so. The webhook URL is built from the address the
 * browser used, and on a homelab that is often a LAN address or a .local name:
 * the card warns instead of handing out a URL that can never be reached.
 */
export function privateHostReason(hostname: string): string | null {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!h) return null
  if (h === 'localhost' || h.endsWith('.localhost')) return 'is this machine (localhost)'
  if (/^127\./.test(h) || h === '::1') return 'is a loopback address'
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'is a private network address'
    if (a === 169 && b === 254) return 'is a link-local address'
    if (a === 100 && b >= 64 && b <= 127) return 'is a carrier-grade NAT or tailnet address'
    return null
  }
  if (h.includes(':')) {
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return 'is a private network address'
    if (/^fe[89ab][0-9a-f]:/.test(h)) return 'is a link-local address'
    return null
  }
  if (/\.(local|lan|home|internal|intranet|home\.arpa|ts\.net)$/.test(h)) return 'is a local network name'
  if (!h.includes('.')) return 'is a single-label (local) name'
  return null
}

/** What the card says about the last delivery or check. */
export type DeliveryResult = 'queued' | 'deploying' | 'deployed' | 'failed' | 'ignored' | 'rejected' | 'pong' | 'refused' | 'demo'
export type SyncResult = 'up-to-date' | 'deploying' | 'deployed' | 'failed' | 'unreachable' | 'held' | 'refused'

export interface DeliveryRecord {
  at: number
  /** Display name of the sender, from its event header ("GitHub", "Gitea", ...). */
  provider: string
  event: string
  ref?: string
  commit?: string
  status: number
  result: DeliveryResult
  message: string
  opId?: string
}

export interface SyncRecord {
  at: number
  result: SyncResult
  commit?: string
  message?: string
  opId?: string
}

/** "refs/heads/main" → "main", "refs/tags/v1" → "tag v1". */
export function shortRef(ref?: string): string {
  if (!ref) return ''
  if (ref.startsWith('refs/heads/')) return ref.slice(11)
  if (ref.startsWith('refs/tags/')) return `tag ${ref.slice(10)}`
  return ref
}

/** One sentence for the last delivery, without the time (the card adds "2 h ago"). */
export function deliveryText(d: DeliveryRecord): string {
  const what = [d.event && d.event !== 'push' ? d.event : 'push', d.ref ? `to ${shortRef(d.ref)}` : ''].filter(Boolean).join(' ')
  const from = d.provider ? ` from ${d.provider}` : ''
  const commit = d.commit ? ` ${d.commit.slice(0, 7)}` : ''
  switch (d.result) {
    case 'pong':
      return `Ping${from}: the URL and secret work.`
    case 'queued':
    case 'deploying':
      return `Deploying${commit}${from} (${what}).`
    case 'deployed':
      return `Deployed${commit}${from} (${what}).`
    case 'failed':
      return `Deploy of${commit || ' the push'} failed${from}: ${d.message}`
    case 'ignored':
      return `Ignored a ${what}${from}: ${d.message}`
    case 'rejected':
      return `Rejected a delivery${from}: ${d.message}`
    case 'refused':
      return `Refused${from}: ${d.message}`
    case 'demo':
      return `Signed ${what}${from}: verified. Demo mode deploys nothing.`
  }
}

export function syncText(s: SyncRecord): string {
  const c = s.commit ? ` (${s.commit.slice(0, 7)})` : ''
  const commit = s.commit ? s.commit.slice(0, 7) : 'the new commit'
  switch (s.result) {
    case 'up-to-date':
      return `Up to date${c}.`
    case 'deploying':
      return `The repository moved${c}: deploying.`
    case 'deployed':
      return `Deployed${c}.`
    case 'failed':
      return `Update to ${commit} failed: ${s.message || 'see the activity feed'}`
    case 'unreachable':
      return `Could not reach the repository${s.message ? `: ${s.message}` : '.'}`
    case 'held':
      return `Holding: the update to ${commit} failed, so it is not retried on its own. Push a fix, or use Update from git.`
    case 'refused':
      return s.message || 'Skipped.'
  }
}

export type Forge = 'github' | 'gitea' | 'gitlab' | 'other'

/** The forge a repository URL most likely lives on (picks the setup tab the card opens on). */
export function guessForge(repoUrl: string): Forge {
  let host = ''
  try {
    host = new URL(repoUrl).hostname.toLowerCase()
  } catch {
    return 'github'
  }
  if (host === 'github.com' || host.endsWith('.ghe.com')) return 'github'
  if (host === 'gitlab.com' || /(^|[.-])gitlab([.-]|$)/.test(host)) return 'gitlab'
  if (host === 'codeberg.org' || /(^|[.-])(gitea|forgejo|gogs)([.-]|$)/.test(host)) return 'gitea'
  if (/(^|[.-])bitbucket([.-]|$)/.test(host)) return 'other'
  // any other host is self-hosted, and on a homelab that is most often Gitea or Forgejo
  return 'gitea'
}

/**
 * Where the forge's "add a webhook" page is for this repository, or null when
 * the URL is not a plain https://host/owner/repo. Paths from the forges' own
 * routes: GitHub /settings/hooks/new, Gitea and Forgejo /settings/hooks,
 * GitLab /-/hooks.
 */
export function forgeHooksUrl(repoUrl: string, forge: Forge): string | null {
  let u: URL
  try {
    u = new URL(repoUrl)
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol)) return null
  const path = u.pathname.replace(/\.git$/, '').replace(/\/+$/, '')
  if (path.split('/').filter(Boolean).length < 2) return null
  const base = `${u.origin}${path}`
  if (forge === 'github') return `${base}/settings/hooks/new`
  if (forge === 'gitea') return `${base}/settings/hooks`
  if (forge === 'gitlab') return `${base}/-/hooks`
  return null
}
