import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from './config'
import { getHosts } from './hosts'
import { startOp, getOp } from './ops'
import { runCompose, selfProject } from './stacks'
import { isGitStack, updateGitStack, checkBehind, stackHeadCommit } from './git-stacks'
import { dispatch } from './alerts'
import { createContainerLock, ContainerBusyError } from './container-lock-core'
import { guard } from './guard'
import { log, warnOnce } from './log'
import { demoGitWebhookSeed, demoIsGitStack } from './demo'
import { autoSyncAction, autoSyncDue, createCoalescer, mintHookId, mintSecret, safeEqual } from './git-webhooks-core'
import { clampSyncInterval, hookPath, AUTO_SYNC_DEFAULT, type DeliveryRecord, type SyncRecord } from '../../shared/utils/git-webhooks.ts'

// Deploy on push, the effectful half: per-stack webhook and auto-sync config in
// ${HOMEPORT_DATA_DIR}/git-webhooks.json (0600, written atomically), the one
// runner every "update from git" goes through (the UI button, a webhook, the
// auto-sync poll), and the poll itself. Decisions live in git-webhooks-core.
//
// The secret is stored as is: an HMAC can only be checked with the key itself
// (unlike an API token, which is stored hashed). It leaves the server once, in
// the answer to "create" or "regenerate", and never in a GET.

interface HookRecord {
  id: string
  secret: string
  /** GitLab's own signing token (GitLab 19+), when the user pasted one. */
  signingKey?: string
  createdAt: number
  rotatedAt?: number
}

interface StackRecord {
  hook?: HookRecord
  autoSync?: { enabled: boolean; intervalMin: number }
  lastDelivery?: DeliveryRecord
  lastSync?: SyncRecord
  /** A remote commit whose automatic update failed: auto-sync holds it (see autoSyncAction). */
  failedCommit?: string
}

interface Store {
  stacks: Record<string, StackRecord>
}

const file = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'git-webhooks.json')
let cache: Store | null = null

function read(): Store {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8'))
    cache = parsed && typeof parsed.stacks === 'object' && parsed.stacks ? { stacks: parsed.stacks } : { stacks: {} }
  } catch {
    cache = { stacks: {} }
  }
  return cache!
}

function persist(): void {
  // demo state is synthetic and per process: nothing to keep
  if (getConfig().demo) return
  try {
    mkdirSync(process.env.HOMEPORT_DATA_DIR || '/data', { recursive: true })
    const tmp = `${file()}.tmp`
    writeFileSync(tmp, JSON.stringify(read(), null, 2), { mode: 0o600 })
    renameSync(tmp, file())
  } catch (e) {
    warnOnce('git-webhooks-ro', 'git-webhooks', 'could not save webhook settings (read-only data dir?): they last until a restart', e)
  }
}

/** The stack's record, seeded with synthetic data in demo mode. */
function rec(name: string, create = false): StackRecord | undefined {
  const st = read().stacks
  if (!st[name] && getConfig().demo && demoIsGitStack(name)) st[name] = demoGitWebhookSeed(name)
  if (!st[name] && create) st[name] = {}
  return st[name]
}

function patch(name: string, fn: (r: StackRecord) => void): void {
  fn(rec(name, true)!)
  persist()
}

export interface WebhookView {
  /** Webhooks switched on (stacks + the webhooks capability). */
  available: boolean
  /** The capability is set by HOMEPORT_ALLOW_GIT_WEBHOOKS, so Settings cannot change it. */
  locked: boolean
  git: boolean
  /** homeport's own stack: never updated from here. */
  self: boolean
  demo: boolean
  hook: { path: string; createdAt: number; rotatedAt?: number; signingKeySet: boolean } | null
  autoSync: { enabled: boolean; intervalMin: number }
  lastDelivery: (DeliveryRecord & { opLive: boolean }) | null
  lastSync: (SyncRecord & { opLive: boolean }) | null
}

/** Everything the stack page shows. Never the secret or the signing key. */
export function webhookView(name: string, opts: { git: boolean; self: boolean }): WebhookView {
  const cfg = getConfig()
  const r = rec(name)
  const live = (opId?: string) => !!opId && !!getOp(opId)
  return {
    available: cfg.allowStacks && cfg.allowGitWebhooks,
    locked: process.env.HOMEPORT_ALLOW_GIT_WEBHOOKS !== undefined && process.env.HOMEPORT_ALLOW_GIT_WEBHOOKS !== '',
    git: opts.git,
    self: opts.self,
    demo: cfg.demo,
    hook: r?.hook
      ? { path: hookPath(name, r.hook.id), createdAt: r.hook.createdAt, rotatedAt: r.hook.rotatedAt, signingKeySet: !!r.hook.signingKey }
      : null,
    autoSync: { enabled: !!r?.autoSync?.enabled, intervalMin: clampSyncInterval(r?.autoSync?.intervalMin ?? AUTO_SYNC_DEFAULT) },
    lastDelivery: r?.lastDelivery ? { ...r.lastDelivery, opLive: live(r.lastDelivery.opId) } : null,
    lastSync: r?.lastSync ? { ...r.lastSync, opLive: live(r.lastSync.opId) } : null,
  }
}

/** A new webhook: fresh URL id and secret. Returns the secret, the one time it is shown. */
export function createHook(name: string): string {
  const secret = mintSecret()
  patch(name, (r) => {
    r.hook = { id: mintHookId(), secret, createdAt: Date.now() }
    delete r.lastDelivery
  })
  return secret
}

/** A new secret for the same URL: the sender's Secret field is the only thing to update. */
export function regenerateSecret(name: string): string {
  const secret = mintSecret()
  patch(name, (r) => {
    if (r.hook) r.hook = { ...r.hook, secret, rotatedAt: Date.now() }
  })
  return secret
}

export function hasHook(name: string): boolean {
  return !!rec(name)?.hook
}

export function removeHook(name: string): void {
  patch(name, (r) => {
    delete r.hook
    delete r.lastDelivery
  })
}

export function setSigningKey(name: string, key: string | null): void {
  patch(name, (r) => {
    if (!r.hook) return
    if (key) r.hook.signingKey = key
    else delete r.hook.signingKey
  })
}

export function setAutoSync(name: string, enabled: boolean, intervalMin: unknown): void {
  patch(name, (r) => {
    r.autoSync = { enabled, intervalMin: clampSyncInterval(intervalMin) }
  })
  lastCheck.delete(name) // switched on: check on the next tick, not one interval later
}

/** Drop everything for a stack (deleted, or a new stack is taking its name). */
export function forgetStack(name: string): void {
  if (!read().stacks[name]) return
  delete read().stacks[name]
  persist()
}

/** The webhook behind a delivery URL, or null. The id compare is constant-time like the secret's. */
export function findHook(name: string, id: string): HookRecord | null {
  const h = rec(name)?.hook
  return h && safeEqual(h.id, id) ? h : null
}

export function recordDelivery(name: string, d: DeliveryRecord): void {
  patch(name, (r) => {
    r.lastDelivery = d
  })
}

function recordSync(name: string, s: SyncRecord): void {
  patch(name, (r) => {
    r.lastSync = s
  })
}

/** homeport's own compose project: never updated by a webhook or auto-sync (it would stop itself mid-update). */
export async function isSelfStack(name: string): Promise<boolean> {
  return name === (await selfProject())
}

// ---- the update runner ----

export type UpdateTrigger = 'manual' | 'push' | 'auto-sync'

// One update from git per stack at a time, whatever started it. Two at once
// race on `git reset` and `compose up --build` in the same folder.
const updateLock = createContainerLock()
const lockKey = (name: string) => `git::${name}`
const TITLE: Record<UpdateTrigger, (n: string) => string> = {
  manual: (n) => `update ${n}`,
  push: (n) => `on push: update ${n}`,
  'auto-sync': (n) => `auto-sync: update ${n}`,
}
const HOLDER: Record<UpdateTrigger, string> = {
  manual: 'an update from git',
  push: 'an update from a git push',
  'auto-sync': 'an auto-sync update',
}

export interface UpdateOutcome {
  ok: boolean
  error?: string
  commit?: string
}

/**
 * Start "update from git" (fetch, hard reset, compose up --build) as a streamed
 * op. Throws ContainerBusyError right away when the stack already has one
 * running, so a click gets a clear 409 instead of a second op.
 */
export function startGitUpdate(name: string, trigger: UpdateTrigger): { opId: string; done: Promise<UpdateOutcome> } {
  const key = lockKey(name)
  if (updateLock.isBusy(key)) throw new ContainerBusyError(key, updateLock.holder(key) || 'another update')
  // an update run by hand is the user saying "try again": clear the auto-sync hold
  if (trigger === 'manual' && rec(name)?.failedCommit) patch(name, (r) => delete r.failedCommit)

  let resolve!: (o: UpdateOutcome) => void
  const done = new Promise<UpdateOutcome>((r) => (resolve = r))
  const opId = startOp(TITLE[trigger](name), (emit) =>
    updateLock.run([key], HOLDER[trigger], async () => {
      if (!(await updateGitStack(name, emit))) return false
      emit(`$ docker compose -p ${name} up -d --build --remove-orphans`)
      const { code } = await runCompose(name, ['up', '-d', '--build', '--remove-orphans'], emit)
      if (code !== 0) {
        emit(`✗ exited with code ${code}`)
        return false
      }
      emit('✓ done')
      return true
    }),
  )
  const op = getOp(opId)!
  op.emitter.once('done', async () => {
    const commit = await stackHeadCommit(name).catch(() => undefined)
    resolve({ ok: !!op.ok, error: op.ok ? undefined : (op.error || 'update failed').replace(/^✗\s*/, ''), commit })
  })
  return { opId, done }
}

async function notifyDone(name: string, trigger: 'push' | 'auto-sync', o: UpdateOutcome): Promise<void> {
  if (o.ok) log.info('git-webhooks', `${trigger}: updated stack "${name}" to ${o.commit || 'the new commit'}`)
  else log.error('git-webhooks', `${trigger}: updating stack "${name}" failed`, o.error)
  try {
    // the durable trail: op buffers last 10 minutes, this lands in the activity feed and the alert channels
    await dispatch({
      id: `git|${name}`,
      name: `stack ${name}`,
      host: getHosts()[0]?.name,
      kind: 'updated',
      from: trigger === 'push' ? 'git push' : 'auto-sync',
      to: o.ok ? '' : o.error || 'update failed',
      at: Date.now(),
    })
  } catch {
    // a broken alert channel never fails the update
  }
}

/**
 * Patch the last delivery with this run's progress, but only while it is a
 * pending push that arrived before the run started (so this run fetched its
 * commit). A push that lands mid-run waits for the run queued after it.
 */
function settleDelivery(name: string, runStart: number, fn: (d: DeliveryRecord) => void): void {
  const d = rec(name)?.lastDelivery
  if (!d || d.at > runStart || (d.result !== 'queued' && d.result !== 'deploying')) return
  patch(name, (r) => fn(r.lastDelivery!))
}

// A burst of pushes runs one update (git-webhooks-core createCoalescer).
export const PUSH_DEBOUNCE_MS = 5_000
const pushRuns = createCoalescer({
  delayMs: PUSH_DEBOUNCE_MS,
  run: async (name) => {
    if (updateLock.isBusy(lockKey(name))) return 'busy'
    if (!isGitStack(name)) return 'done'
    if (await isSelfStack(name)) return 'done' // checked when the push arrived too; this is the backstop
    // the pushed commit, for the auto-sync hold: when the fetch itself failed, HEAD is still the old one
    const pushed = rec(name)?.lastDelivery?.commit
    const runStart = Date.now()
    let started: ReturnType<typeof startGitUpdate>
    try {
      started = startGitUpdate(name, 'push')
    } catch (e) {
      if (e instanceof ContainerBusyError) return 'busy'
      throw e
    }
    settleDelivery(name, runStart, (d) => {
      d.result = 'deploying'
      d.opId = started.opId
    })
    const o = await started.done
    settleDelivery(name, runStart, (d) => {
      d.result = o.ok ? 'deployed' : 'failed'
      d.message = o.ok ? '' : o.error || 'update failed'
      d.opId = started.opId
    })
    patch(name, (r) => {
      if (o.ok) delete r.failedCommit
      else if (pushed || o.commit) r.failedCommit = pushed || o.commit
    })
    await notifyDone(name, 'push', o)
    return 'done'
  },
})

/** Queue an update for a verified push. Bursts merge; a push during a running update queues one more. */
export function triggerPushUpdate(name: string): 'scheduled' | 'merged' | 'queued' {
  return pushRuns.trigger(name)
}

// ---- auto-sync: poll the remote, update when it moved ----

const lastCheck = new Map<string, number>()

/** Called from the collector each tick: checks the stacks whose interval is up. */
export const maybeAutoSync = guard(async () => {
  const cfg = getConfig()
  if (cfg.demo || !cfg.allowStacks) return
  const now = Date.now()
  const due = Object.entries(read().stacks).filter(
    ([name, r]) => r.autoSync?.enabled && autoSyncDue(lastCheck.get(name) ?? r.lastSync?.at, clampSyncInterval(r.autoSync.intervalMin), now),
  )
  if (!due.length) return
  const self = await selfProject()

  for (const [name, r] of due) {
    lastCheck.set(name, now)
    if (!isGitStack(name)) continue
    if (name === self) {
      recordSync(name, { at: now, result: 'refused', message: "homeport's own stack is never updated by auto-sync: use Update homeport." })
      continue
    }
    // an update is already on its way (a push, a click): this round has nothing to add
    if (updateLock.isBusy(lockKey(name)) || pushRuns.phase(name) !== 'idle') continue

    const { behind, remoteCommit } = await checkBehind(name, true)
    const action = autoSyncAction(behind, remoteCommit, r.failedCommit)
    if (action !== 'deploy') {
      recordSync(name, { at: Date.now(), result: action, commit: remoteCommit })
      continue
    }
    let started: ReturnType<typeof startGitUpdate>
    try {
      started = startGitUpdate(name, 'auto-sync')
    } catch {
      continue // grabbed by a click between the check and now
    }
    recordSync(name, { at: Date.now(), result: 'deploying', commit: remoteCommit, opId: started.opId })
    // not awaited: one stack's long build must not delay the other stacks' checks
    void started.done.then(async (o) => {
      recordSync(name, { at: Date.now(), result: o.ok ? 'deployed' : 'failed', commit: o.commit || remoteCommit, message: o.error, opId: started.opId })
      patch(name, (x) => {
        if (o.ok) delete x.failedCommit
        else x.failedCommit = remoteCommit
      })
      await notifyDone(name, 'auto-sync', o)
    })
  }
})
