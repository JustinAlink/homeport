import { readCapped } from '../../../../utils/read-capped'
import { getConfig } from '../../../../utils/config'
import { safeStackName } from '../../../../utils/stacks-core'
import { isGitStack, stackFollowedRef } from '../../../../utils/git-stacks'
import { findHook, recordDelivery, isSelfStack, triggerPushUpdate } from '../../../../utils/git-webhooks'
import {
  MAX_BODY_BYTES,
  PROVIDER_LABEL,
  decide,
  detectProvider,
  parseDelivery,
  parsePayload,
  rateAllow,
  validHookId,
  verifyDelivery,
} from '../../../../utils/git-webhooks-core'
import { log } from '../../../../utils/log'

// The public end of "deploy on push": GitHub, Gitea/Forgejo, GitLab, Bitbucket
// or any script POSTs here when the repository changes. No session: the auth
// middleware lets /api/hooks/git/ through, so this handler is the whole gate,
// and it fails closed at every step:
//   stacks or webhooks off            403 (before anything is looked up)
//   unknown stack, unknown id         404, the same answer for both
//   more than RATE_LIMIT a minute     429
//   body over MAX_BODY_BYTES          413
//   missing or wrong signature        401 (the reason goes to the stack page, not the caller)
//   a push for another ref, a ping    202 / 200, nothing runs
// A matching push queues the same update as the stack page's button; the
// answer is immediate (forges time out after ~10 s) and the run is coalesced.

const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000
const rates = new Map<string, { start: number; count: number }>()

const notFound = () => createError({ statusCode: 404, statusMessage: 'Not Found' })

export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  if (!cfg.allowStacks || !cfg.allowGitWebhooks) {
    throw createError({ statusCode: 403, statusMessage: 'Git webhooks are turned off on this homeport' })
  }

  const stack = safeStackName(String(getRouterParam(event, 'stack') || ''))
  const id = String(getRouterParam(event, 'id') || '') // base64url: never needs decoding, validHookId refuses the rest
  const hook = stack && validHookId(id) ? findHook(stack, id) : null
  if (!stack || !hook) throw notFound()

  const rateKey = `${stack}/${hook.id}`
  if (rates.size > 1000) rates.clear() // bounded: only known hooks get here
  const rate = rateAllow(rates.get(rateKey), Date.now(), RATE_LIMIT, RATE_WINDOW_MS)
  rates.set(rateKey, rate.next)
  if (!rate.allowed) {
    setHeader(event, 'Retry-After', Math.ceil(RATE_WINDOW_MS / 1000))
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  // byte for byte: signatures are over these exact bytes
  const body = await readCapped(event, MAX_BODY_BYTES)
  const get = (n: string) => getHeader(event, n)
  const provider = detectProvider(get)
  const sender = PROVIDER_LABEL[provider]
  const at = Date.now()

  const verdict = verifyDelivery(get, body, { secret: hook.secret, signingKey: hook.signingKey }, at)
  if (!verdict.ok) {
    recordDelivery(stack, { at, provider: sender, event: '', status: 401, result: 'rejected', message: verdict.reason })
    log.warn('git-webhooks', `rejected a delivery for "${stack}" from ${sender}: ${verdict.reason}`)
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing signature' })
  }

  const payload = parsePayload(body, getHeader(event, 'content-type') || '')
  if (payload === null) {
    recordDelivery(stack, { at, provider: sender, event: '', status: 400, result: 'rejected', message: 'the body is not JSON' })
    throw createError({ statusCode: 400, statusMessage: 'The payload is not JSON' })
  }
  const info = parseDelivery(provider, get, payload)
  const base = { at, provider: sender, event: info.event, commit: info.commit }

  if (cfg.demo) {
    // demo: verified for real, then nothing runs
    const d = decide(info, provider, 'main')
    if (d.action === 'ignore') {
      recordDelivery(stack, { ...base, ref: d.ref, status: 202, result: 'ignored', message: d.reason })
      setResponseStatus(event, 202)
      return { ok: true, ignored: true, reason: d.reason }
    }
    const result = d.action === 'pong' ? 'pong' : 'demo'
    recordDelivery(stack, { ...base, ref: d.action === 'deploy' ? d.ref : undefined, status: 200, result, message: 'demo mode: nothing was deployed' })
    return { ok: true, demo: true, result: d.action === 'pong' ? 'pong' : 'verified', message: 'Signature verified. Demo mode deploys nothing.' }
  }

  // the stack folder went away behind homeport's back: as unknown as any other
  if (!isGitStack(stack)) throw notFound()

  if (await isSelfStack(stack)) {
    const reason = "this is homeport's own stack, which never updates itself from git: use Update homeport"
    recordDelivery(stack, { ...base, status: 202, result: 'refused', message: reason })
    setResponseStatus(event, 202)
    return { ok: true, ignored: true, reason }
  }

  const followed = (await stackFollowedRef(stack)) || 'HEAD'
  const d = decide(info, provider, followed)
  if (d.action === 'pong') {
    recordDelivery(stack, { ...base, status: 200, result: 'pong', message: '' })
    return { ok: true, result: 'pong' }
  }
  if (d.action === 'ignore') {
    recordDelivery(stack, { ...base, ref: d.ref, status: 202, result: 'ignored', message: d.reason })
    setResponseStatus(event, 202)
    return { ok: true, ignored: true, reason: d.reason }
  }

  const queued = triggerPushUpdate(stack)
  recordDelivery(stack, { ...base, ref: d.ref, commit: d.commit, status: 200, result: 'queued', message: '' })
  return {
    ok: true,
    // scheduled: starts in a few seconds; merged: joins an update about to start; queued: runs after the current one
    result: queued,
    stack,
    ref: d.ref,
    commit: d.commit?.slice(0, 7),
  }
})
