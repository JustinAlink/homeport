import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { HeaderGetter } from './csrf-core.ts'
import { safeStackName } from './stacks-core.ts'
import { clampSyncInterval } from '../../shared/utils/git-webhooks.ts'

// Deploy on push, the pure half: who sent a delivery, whether it carries the
// stack's secret, whether the push is for the ref the stack follows, and the
// coalescing that turns a burst of pushes into one update. No fs, no exec, no
// Nuxt auto-imports, so every rule here is unit-tested (test/git-webhooks.test.ts).
//
// Signature schemes, from each provider's documentation:
//   GitHub            X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>
//   Gitea / Forgejo   X-Gitea-Signature / X-Forgejo-Signature: <hex, no prefix>
//                     (they send X-Hub-Signature-256 too, same digest)
//   Bitbucket         X-Hub-Signature: sha256=<hex>
//   GitLab            X-Gitlab-Token: <the secret, as is>, or since GitLab 19
//                     a "signing token" (Standard Webhooks: webhook-signature)
//   anything else     X-Homeport-Secret: <secret> or Authorization: Bearer <secret>

export type Provider = 'github' | 'gitea' | 'forgejo' | 'gitlab' | 'bitbucket' | 'generic'

export const PROVIDER_LABEL: Record<Provider, string> = {
  github: 'GitHub',
  gitea: 'Gitea',
  forgejo: 'Forgejo',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  generic: 'a generic sender',
}

/** Push payloads with a long commit list run to a few hundred KB; nothing legitimate needs more. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024

/** Standard Webhooks: a signed timestamp older (or newer) than this is a replay. */
export const SIGNATURE_TOLERANCE_S = 5 * 60

/** The routing id in the public URL. Not the secret, but unguessable all the same. */
export function mintHookId(): string {
  return randomBytes(18).toString('base64url')
}

/** 256 bits as hex: pastes cleanly into every provider's secret field. */
export function mintSecret(): string {
  return randomBytes(32).toString('hex')
}

export const validHookId = (id: string) => /^[A-Za-z0-9_-]{16,64}$/.test(String(id || ''))

/**
 * GitLab's signing token as it shows it ("whsec_" + base64 key). Kept to the
 * documented shape so a pasted secret token or URL is refused, not stored.
 */
export function validSigningKey(raw: string): string | null {
  const k = String(raw || '').trim()
  const m = /^whsec_([A-Za-z0-9+/]{16,}={0,2})$/.exec(k)
  if (!m) return null
  return Buffer.from(m[1], 'base64').length >= 16 ? k : null
}

/**
 * Constant-time string equality. Both sides are hashed first, so the compare
 * runs over equal-length buffers and leaks neither content nor length.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(String(a)).digest()
  const hb = createHash('sha256').update(String(b)).digest()
  return timingSafeEqual(ha, hb)
}

export const hmacHex = (secret: string, body: Buffer) => createHmac('sha256', secret).update(body).digest('hex')

/** Which forge sent this, from its event header (Gitea and Forgejo also send X-GitHub-Event, so they are asked first). */
export function detectProvider(get: HeaderGetter): Provider {
  if (get('x-forgejo-event')) return 'forgejo'
  if (get('x-gitea-event') || get('x-gogs-event')) return 'gitea'
  if (get('x-gitlab-event')) return 'gitlab'
  if (get('x-event-key')) return 'bitbucket'
  if (get('x-github-event')) return 'github'
  return 'generic'
}

export type Verdict = { ok: true; scheme: 'hmac' | 'signing-token' | 'token' } | { ok: false; reason: string }

function verifyHexHmac(value: string, prefix: string, secret: string, body: Buffer, header: string): Verdict {
  const v = value.trim()
  if (!v || v === prefix) return { ok: false, reason: `${header} is empty: the sender has no secret set. Paste the secret into its Secret field.` }
  if (prefix && !v.toLowerCase().startsWith(prefix)) return { ok: false, reason: `${header} is not a SHA-256 signature` }
  const got = v.slice(prefix.length).toLowerCase()
  return safeEqual(got, hmacHex(secret, body))
    ? { ok: true, scheme: 'hmac' }
    : { ok: false, reason: `${header} does not match: the sender signs with a different secret` }
}

function verifyStandardWebhook(get: HeaderGetter, body: Buffer, signingKey: string, nowMs: number): Verdict {
  const id = get('webhook-id') || ''
  const ts = get('webhook-timestamp') || ''
  const sigs = get('webhook-signature') || ''
  if (!id || !/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'webhook-signature without a valid webhook-id and webhook-timestamp' }
  if (Math.abs(nowMs / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_S) {
    return { ok: false, reason: 'the signed timestamp is more than 5 minutes off: a replayed delivery, or a clock that is wrong' }
  }
  const key = Buffer.from(signingKey.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${ts}.`).update(body).digest('base64')
  for (const part of sigs.split(' ')) {
    const [ver, sig] = part.split(',', 2)
    if (ver === 'v1' && sig && safeEqual(sig, expected)) return { ok: true, scheme: 'signing-token' }
  }
  return { ok: false, reason: 'webhook-signature does not match: the signing token saved here is not the one the sender uses' }
}

/**
 * Does this delivery carry the stack's secret? The first signature header that
 * is present decides, and only that one: a request with a wrong HMAC is refused
 * even if it also carries some other header. A body-signing scheme beats a
 * plain token, because a token proves nothing about the body.
 */
export function verifyDelivery(
  get: HeaderGetter,
  body: Buffer,
  keys: { secret: string; signingKey?: string },
  nowMs = Date.now(),
): Verdict {
  if (!keys.secret) return { ok: false, reason: 'no secret configured' }
  const hub256 = get('x-hub-signature-256')
  if (hub256 != null) return verifyHexHmac(hub256, 'sha256=', keys.secret, body, 'X-Hub-Signature-256')
  for (const h of ['x-gitea-signature', 'x-forgejo-signature', 'x-gogs-signature']) {
    const v = get(h)
    if (v != null) return verifyHexHmac(v, '', keys.secret, body, h.replace(/(^|-)([a-z])/g, (_, d, c) => d + c.toUpperCase()))
  }
  // Bitbucket signs with SHA-256 in the old header name; GitHub's SHA-1 copy is not enough.
  const hub = get('x-hub-signature')
  if (hub != null) {
    if (/^sha1=/i.test(hub.trim())) return { ok: false, reason: 'X-Hub-Signature is SHA-1, which is not accepted: use X-Hub-Signature-256' }
    return verifyHexHmac(hub, 'sha256=', keys.secret, body, 'X-Hub-Signature')
  }
  const signed = get('webhook-signature')
  if (signed != null && keys.signingKey) return verifyStandardWebhook(get, body, keys.signingKey, nowMs)

  const token = get('x-gitlab-token') ?? get('x-homeport-secret')
  if (token != null) {
    return safeEqual(token.trim(), keys.secret) ? { ok: true, scheme: 'token' } : { ok: false, reason: 'the secret token does not match' }
  }
  const authz = get('authorization') || ''
  if (/^bearer\s/i.test(authz)) {
    return safeEqual(authz.slice(7).trim(), keys.secret) ? { ok: true, scheme: 'token' } : { ok: false, reason: 'the bearer secret does not match' }
  }
  if (signed != null) {
    return { ok: false, reason: 'signed with a signing token homeport does not have: paste it into the GitLab tab, or use the secret token instead' }
  }
  return { ok: false, reason: 'no signature or secret in the request' }
}

export interface PushInfo {
  kind: 'push' | 'ping' | 'other'
  /** The event as the sender named it ("push", "Tag Push Hook", "repo:push"). */
  event: string
  /** Full refs the push moved ("refs/heads/main"); empty when the payload names none. */
  refs: string[]
  commit?: string
  /** The push deleted the ref (nothing to deploy). */
  deleted?: boolean
  defaultBranch?: string
}

const ZERO_SHA = /^0{40}$/

/**
 * The JSON a delivery carries: raw JSON, or GitHub/Gitea's form mode
 * (`payload=<json>`). A JSON body labelled as a form (curl -d does that by
 * default) is still read as JSON. null = not readable.
 */
export function parsePayload(body: Buffer, contentType: string): any {
  const text = body.toString('utf8').trim()
  if (!text) return {}
  try {
    if (/application\/x-www-form-urlencoded/i.test(contentType)) {
      const p = new URLSearchParams(text).get('payload')
      if (p) return JSON.parse(p)
    }
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** What a verified delivery asks for, read from its event header and payload. */
export function parseDelivery(provider: Provider, get: HeaderGetter, payload: any): PushInfo {
  const p = payload && typeof payload === 'object' ? payload : {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  const info: PushInfo = { kind: 'other', event: '', refs: [] }

  if (provider === 'bitbucket') {
    info.event = get('x-event-key') || ''
    if (info.event === 'diagnostics:ping') info.kind = 'ping'
    else if (info.event === 'repo:push' || info.event === 'repo:refs_changed') info.kind = 'push'
    // Cloud: push.changes[].new {type, name}; Data Center: changes[].ref.id
    for (const c of Array.isArray(p.push?.changes) ? p.push.changes : []) {
      // a deleted branch has no `new`, only `old`
      const n = c?.new ?? c?.old
      if (n?.name) info.refs.push(`${n.type === 'tag' ? 'refs/tags/' : 'refs/heads/'}${n.name}`)
      if (!c?.new && c?.old) info.deleted = true
      else info.commit ??= str(n?.target?.hash)
    }
    for (const c of Array.isArray(p.changes) ? p.changes : []) {
      if (str(c?.ref?.id)) info.refs.push(c.ref.id)
      if (c?.type === 'DELETE') info.deleted = true
      info.commit ??= str(c?.toHash)
    }
    return info
  }

  if (provider === 'gitlab') {
    info.event = get('x-gitlab-event') || ''
    if (info.event === 'Push Hook' || info.event === 'Tag Push Hook') info.kind = 'push'
    info.defaultBranch = str(p.project?.default_branch)
  } else if (provider === 'generic') {
    info.event = 'push'
    info.kind = 'push'
  } else {
    info.event = get('x-forgejo-event') || get('x-gitea-event') || get('x-gogs-event') || get('x-github-event') || ''
    if (info.event === 'ping') info.kind = 'ping'
    else if (info.event === 'push') info.kind = 'push'
    info.defaultBranch = str(p.repository?.default_branch)
  }
  const ref = str(p.ref)
  if (ref) info.refs.push(ref)
  const after = str(p.after) ?? str(p.checkout_sha)
  if (after && !ZERO_SHA.test(after)) info.commit = after
  if (p.deleted === true || (after && ZERO_SHA.test(after))) info.deleted = true
  return info
}

/**
 * Is a pushed ref the one this stack follows? The followed ref is a bare
 * branch or tag name (what the clone recorded), so both namespaces count. A
 * generic sender may name it bare. "HEAD" (a clone too old to have recorded
 * its ref) follows the repository's default branch, when the payload says which.
 */
export function refMatches(pushed: string, followed: string, defaultBranch?: string): boolean {
  if (!pushed || !followed) return false
  if (followed === 'HEAD') return !!defaultBranch && pushed === `refs/heads/${defaultBranch}`
  return pushed === followed || pushed === `refs/heads/${followed}` || pushed === `refs/tags/${followed}`
}

export type Decision =
  | { action: 'deploy'; ref?: string; commit?: string }
  | { action: 'pong' }
  | { action: 'ignore'; reason: string; ref?: string }

/** Deploy, answer a ping, or ignore (with the reason the sender and the card show). */
export function decide(info: PushInfo, provider: Provider, followed: string): Decision {
  if (info.kind === 'ping') return { action: 'pong' }
  if (info.kind !== 'push') return { action: 'ignore', reason: `"${info.event || 'unknown'}" events do not deploy, only pushes do` }
  // a bare POST from a script or CI step: "deploy now", like a deploy button
  if (!info.refs.length) {
    return provider === 'generic' ? { action: 'deploy' } : { action: 'ignore', reason: 'the push names no ref' }
  }
  const hit = info.refs.find((r) => refMatches(r, followed, info.defaultBranch))
  if (!hit) {
    const pushed = info.refs.map((r) => r.replace(/^refs\/(heads|tags)\//, '')).join(', ')
    return { action: 'ignore', ref: info.refs[0], reason: `push to ${pushed}, and this stack follows ${followed}` }
  }
  if (info.deleted) return { action: 'ignore', ref: hit, reason: `the push deleted ${hit.replace(/^refs\/(heads|tags)\//, '')}` }
  return { action: 'deploy', ref: hit, commit: info.commit }
}

/**
 * Fixed-window rate limit per webhook. Pushes are coalesced anyway; this caps
 * what someone holding only the URL can make homeport do (hash bodies, write
 * the "last delivery" record).
 */
export function rateAllow(
  st: { start: number; count: number } | undefined,
  now: number,
  limit: number,
  windowMs: number,
): { allowed: boolean; next: { start: number; count: number } } {
  const cur = !st || now - st.start >= windowMs ? { start: now, count: 0 } : st
  if (cur.count >= limit) return { allowed: false, next: cur }
  return { allowed: true, next: { start: cur.start, count: cur.count + 1 } }
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void }
const realTimers: Timers = {
  set: (fn, ms) => {
    const h = setTimeout(fn, ms)
    h.unref?.() // never keep the process alive for a pending deploy
    return h
  },
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/**
 * Turns triggers into runs, one stack at a time:
 *  - the first trigger waits `delayMs`, and every trigger in that window joins
 *    it (a push of three branches, or a tag and its branch, is one update);
 *  - a trigger while the run is going queues exactly one more run after it,
 *    because the running update may have fetched before that push landed;
 *  - a run that reports 'busy' (another update of the stack holds the lock,
 *    say a click in the UI) is retried after `delayMs`, up to `maxRetries`.
 */
export function createCoalescer(opts: {
  delayMs: number
  maxRetries?: number
  run: (key: string) => Promise<'done' | 'busy'>
  timers?: Timers
}) {
  const timers = opts.timers ?? realTimers
  const maxRetries = opts.maxRetries ?? 120
  const state = new Map<string, { phase: 'waiting' | 'running'; again: boolean; retries: number }>()

  const schedule = (key: string) => {
    const s = state.get(key)!
    s.phase = 'waiting'
    timers.set(() => void fire(key), opts.delayMs)
  }

  async function fire(key: string) {
    const s = state.get(key)
    if (!s) return
    s.phase = 'running'
    let res: 'done' | 'busy' = 'done'
    try {
      res = await opts.run(key)
    } catch {
      res = 'done' // the runner reports its own failures; a throw must not wedge the key
    }
    if (res === 'busy' && s.retries < maxRetries) {
      s.retries++
      return schedule(key)
    }
    s.retries = 0
    if (s.again) {
      s.again = false
      return schedule(key)
    }
    state.delete(key)
  }

  return {
    trigger(key: string): 'scheduled' | 'merged' | 'queued' {
      const s = state.get(key)
      if (!s) {
        state.set(key, { phase: 'waiting', again: false, retries: 0 })
        schedule(key)
        return 'scheduled'
      }
      if (s.phase === 'waiting') return 'merged'
      s.again = true
      return 'queued'
    },
    phase: (key: string): 'idle' | 'waiting' | 'running' => state.get(key)?.phase ?? 'idle',
  }
}

/** Is a stack's auto-sync check due? */
export function autoSyncDue(lastCheckAt: number | undefined, intervalMin: number, now: number): boolean {
  return lastCheckAt === undefined || now - lastCheckAt >= intervalMin * 60_000
}

/**
 * What an auto-sync check does with what it found. A commit whose update
 * already failed is held, not retried every interval: a broken build would
 * otherwise rebuild (and notify) every few minutes until someone notices. It
 * also reads "held", not "up to date", once its files are checked out: a
 * failed `compose up` leaves HEAD at the remote while the old containers run.
 * A new commit, or an update that succeeds (by hand or on push), clears it.
 */
export function autoSyncAction(
  behind: boolean | null,
  remoteCommit: string | undefined,
  failedCommit: string | undefined,
): 'deploy' | 'up-to-date' | 'unreachable' | 'held' {
  if (behind === null) return 'unreachable'
  if (failedCommit && remoteCommit && failedCommit.startsWith(remoteCommit.slice(0, 7))) return 'held'
  return behind ? 'deploy' : 'up-to-date'
}

/** What a backup carries per stack: its webhook and its auto-sync setting. */
export interface WebhookBackupEntry {
  hook?: { id: string; secret: string; signingKey?: string; createdAt: number; rotatedAt?: number }
  autoSync?: { enabled: boolean; intervalMin: number }
}

/**
 * The webhook settings from a backup file, keeping only well-formed entries: a
 * valid stack name, a URL id and secret in the shapes homeport mints, a signing
 * key in GitLab's documented shape. Run history (deliveries, syncs, a held commit)
 * is never part of it: that is this server's past, not its configuration. The
 * file is the admin's own, but it is still input, and a bad entry must not land
 * on a public endpoint.
 */
export function sanitizeWebhookBackup(data: unknown): Record<string, WebhookBackupEntry> {
  const out: Record<string, WebhookBackupEntry> = {}
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out
  for (const [rawName, raw] of Object.entries(data as Record<string, unknown>)) {
    const name = safeStackName(rawName)
    if (!name || !raw || typeof raw !== 'object') continue
    const r = raw as Record<string, any>
    const entry: WebhookBackupEntry = {}
    const h = r.hook
    if (h && typeof h === 'object' && validHookId(h.id) && typeof h.secret === 'string' && /^[0-9a-f]{64}$/.test(h.secret)) {
      entry.hook = { id: h.id, secret: h.secret, createdAt: Number.isFinite(h.createdAt) ? h.createdAt : Date.now() }
      const key = typeof h.signingKey === 'string' ? validSigningKey(h.signingKey) : null
      if (key) entry.hook.signingKey = key
      if (Number.isFinite(h.rotatedAt)) entry.hook.rotatedAt = h.rotatedAt
    }
    if (r.autoSync && typeof r.autoSync === 'object') {
      entry.autoSync = { enabled: r.autoSync.enabled === true, intervalMin: clampSyncInterval(r.autoSync.intervalMin) }
    }
    if (entry.hook || entry.autoSync) out[name] = entry
  }
  return out
}
