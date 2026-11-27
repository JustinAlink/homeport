import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  sanitizeWebhookBackup,
  verifyDelivery,
  detectProvider,
  parseDelivery,
  parsePayload,
  decide,
  refMatches,
  createCoalescer,
  rateAllow,
  autoSyncDue,
  autoSyncAction,
  safeEqual,
  validHookId,
  validSigningKey,
  mintHookId,
  mintSecret,
  hmacHex,
} from '../server/utils/git-webhooks-core.ts'
import type { HeaderGetter } from '../server/utils/csrf-core.ts'
import {
  clampSyncInterval,
  privateHostReason,
  guessForge,
  forgeHooksUrl,
  deliveryText,
  syncText,
  hookPath,
  AUTO_SYNC_MIN,
  AUTO_SYNC_MAX,
} from '../shared/utils/git-webhooks.ts'
import { scopeAllows } from '../server/utils/api-tokens-core.ts'
import { eventText } from '../server/utils/notifiers/format.ts'

const SECRET = 'a'.repeat(64)
const headers = (h: Record<string, string>): HeaderGetter => {
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]))
  return (n) => lower[n.toLowerCase()]
}
const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main', after: 'b'.repeat(40) }))
const sig = (secret: string, b: Buffer) => createHmac('sha256', secret).update(b).digest('hex')

// ---- signatures, per provider ----

test('GitHub: the documented test vector verifies (X-Hub-Signature-256, sha256=<hex> of the raw body)', () => {
  // from docs.github.com "Validating webhook deliveries"
  const get = headers({ 'X-Hub-Signature-256': 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17' })
  assert.deepEqual(verifyDelivery(get, Buffer.from('Hello, World!'), { secret: "It's a Secret to Everybody" }), { ok: true, scheme: 'hmac' })
})

test('GitHub: wrong secret, tampered body, missing or empty signature are all refused', () => {
  const good = `sha256=${sig(SECRET, body)}`
  assert.equal(verifyDelivery(headers({ 'X-Hub-Signature-256': good }), body, { secret: SECRET }).ok, true)
  assert.equal(verifyDelivery(headers({ 'X-Hub-Signature-256': good.toUpperCase().replace('SHA256=', 'sha256=') }), body, { secret: SECRET }).ok, true)
  assert.equal(verifyDelivery(headers({ 'X-Hub-Signature-256': `sha256=${sig('other', body)}` }), body, { secret: SECRET }).ok, false)
  const tampered = Buffer.from(body.toString().replace('main', 'mainx'))
  assert.equal(verifyDelivery(headers({ 'X-Hub-Signature-256': good }), tampered, { secret: SECRET }).ok, false)
  // a trailing newline is a different body: signatures are over the exact bytes
  assert.equal(verifyDelivery(headers({ 'X-Hub-Signature-256': good }), Buffer.concat([body, Buffer.from('\n')]), { secret: SECRET }).ok, false)
  const missing = verifyDelivery(headers({ 'X-GitHub-Event': 'push' }), body, { secret: SECRET })
  assert.equal(missing.ok, false)
  assert.match((missing as any).reason, /no signature/)
  const empty = verifyDelivery(headers({ 'X-Hub-Signature-256': '' }), body, { secret: SECRET })
  assert.match((empty as any).reason, /no secret set/)
  // the bare hex without the sha256= prefix is not GitHub's format
  assert.equal(verifyDelivery(headers({ 'X-Hub-Signature-256': sig(SECRET, body) }), body, { secret: SECRET }).ok, false)
})

test('GitHub legacy SHA-1 signature alone is not enough', () => {
  const sha1 = createHmac('sha1', SECRET).update(body).digest('hex')
  const v = verifyDelivery(headers({ 'X-Hub-Signature': `sha1=${sha1}` }), body, { secret: SECRET })
  assert.equal(v.ok, false)
  assert.match((v as any).reason, /SHA-1/)
})

test('Gitea / Forgejo / Gogs: bare hex HMAC, tampered and wrong refused', () => {
  for (const h of ['X-Gitea-Signature', 'X-Forgejo-Signature', 'X-Gogs-Signature']) {
    assert.equal(verifyDelivery(headers({ [h]: sig(SECRET, body) }), body, { secret: SECRET }).ok, true, h)
    assert.equal(verifyDelivery(headers({ [h]: sig(SECRET, Buffer.from('{}')) }), body, { secret: SECRET }).ok, false, h)
    assert.equal(verifyDelivery(headers({ [h]: sig('nope', body) }), body, { secret: SECRET }).ok, false, h)
    assert.equal(verifyDelivery(headers({ [h]: '' }), body, { secret: SECRET }).ok, false, h)
  }
})

test('the first signature header present decides: a wrong HMAC is not rescued by another header', () => {
  const get = headers({ 'X-Hub-Signature-256': `sha256=${sig('wrong', body)}`, 'X-Gitea-Signature': sig(SECRET, body), 'X-Gitlab-Token': SECRET })
  assert.equal(verifyDelivery(get, body, { secret: SECRET }).ok, false)
})

test('Bitbucket: X-Hub-Signature with sha256=', () => {
  assert.equal(verifyDelivery(headers({ 'X-Hub-Signature': `sha256=${sig(SECRET, body)}` }), body, { secret: SECRET }).ok, true)
  assert.equal(verifyDelivery(headers({ 'X-Hub-Signature': `sha256=${sig('x', body)}` }), body, { secret: SECRET }).ok, false)
})

test('GitLab: X-Gitlab-Token compared as a whole, wrong and missing refused', () => {
  assert.deepEqual(verifyDelivery(headers({ 'X-Gitlab-Token': SECRET }), body, { secret: SECRET }), { ok: true, scheme: 'token' })
  assert.equal(verifyDelivery(headers({ 'X-Gitlab-Token': SECRET.slice(0, -1) }), body, { secret: SECRET }).ok, false)
  assert.equal(verifyDelivery(headers({ 'X-Gitlab-Token': `${SECRET}x` }), body, { secret: SECRET }).ok, false)
  assert.equal(verifyDelivery(headers({ 'X-Gitlab-Token': '' }), body, { secret: SECRET }).ok, false)
  assert.equal(verifyDelivery(headers({ 'X-Gitlab-Event': 'Push Hook' }), body, { secret: SECRET }).ok, false)
})

test('GitLab signing token (Standard Webhooks): signed id.timestamp.body, replay window, tampering', () => {
  const key = `whsec_${Buffer.from('k'.repeat(32)).toString('base64')}`
  const now = 1_800_000_000_000
  const ts = String(now / 1000)
  const sign = (b: Buffer, t = ts, id = 'msg_1') =>
    `v1,${createHmac('sha256', Buffer.from('k'.repeat(32))).update(`${id}.${t}.`).update(b).digest('base64')}`
  const h = (s: string, t = ts) => headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': s })
  assert.deepEqual(verifyDelivery(h(sign(body)), body, { secret: SECRET, signingKey: key }, now), { ok: true, scheme: 'signing-token' })
  // several signatures (key rotation): any v1 that matches
  assert.equal(verifyDelivery(h(`v1,bm9wZQ== ${sign(body)}`), body, { secret: SECRET, signingKey: key }, now).ok, true)
  assert.equal(verifyDelivery(h(sign(Buffer.from('{}'))), body, { secret: SECRET, signingKey: key }, now).ok, false)
  // an old delivery replayed: refused even with a valid signature
  const old = String(now / 1000 - 600)
  assert.match((verifyDelivery(h(sign(body, old), old), body, { secret: SECRET, signingKey: key }, now) as any).reason, /5 minutes/)
  // the id is part of what is signed
  assert.equal(verifyDelivery(headers({ 'webhook-id': 'msg_2', 'webhook-timestamp': ts, 'webhook-signature': sign(body) }), body, { secret: SECRET, signingKey: key }, now).ok, false)
})

test('GitLab: a signature homeport has no key for falls back to the secret token, else is refused with a hint', () => {
  const signed = { 'webhook-id': 'm', 'webhook-timestamp': '1', 'webhook-signature': 'v1,abc' }
  assert.equal(verifyDelivery(headers({ ...signed, 'X-Gitlab-Token': SECRET }), body, { secret: SECRET }).ok, true)
  const v = verifyDelivery(headers(signed), body, { secret: SECRET })
  assert.equal(v.ok, false)
  assert.match((v as any).reason, /signing token/)
})

test('generic senders: X-Homeport-Secret or Authorization: Bearer', () => {
  assert.equal(verifyDelivery(headers({ 'X-Homeport-Secret': SECRET }), body, { secret: SECRET }).ok, true)
  assert.equal(verifyDelivery(headers({ Authorization: `Bearer ${SECRET}` }), body, { secret: SECRET }).ok, true)
  assert.equal(verifyDelivery(headers({ Authorization: `Bearer ${SECRET}1` }), body, { secret: SECRET }).ok, false)
  assert.equal(verifyDelivery(headers({ Authorization: `Basic ${Buffer.from(`x:${SECRET}`).toString('base64')}` }), body, { secret: SECRET }).ok, false)
  assert.equal(verifyDelivery(headers({ 'X-Homeport-Secret': 'nope' }), body, { secret: SECRET }).ok, false)
})

test('no secret configured means nothing verifies (fail closed)', () => {
  assert.equal(verifyDelivery(headers({ 'X-Hub-Signature-256': `sha256=${hmacHex('', body)}` }), body, { secret: '' }).ok, false)
  assert.equal(verifyDelivery(headers({ 'X-Homeport-Secret': '' }), body, { secret: '' }).ok, false)
})

test('safeEqual: equal strings only, whatever the lengths', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(safeEqual('', 'a'), false)
  assert.equal(safeEqual('', ''), true)
})

test('minted ids and secrets: unguessable, URL-safe, validated on the way in', () => {
  const id = mintHookId()
  assert.equal(validHookId(id), true)
  assert.notEqual(mintHookId(), id)
  assert.match(mintSecret(), /^[0-9a-f]{64}$/)
  assert.equal(validHookId('short'), false)
  assert.equal(validHookId('../../etc/passwd/xxxxxxxx'), false)
  assert.equal(validHookId('a'.repeat(65)), false)
})

test('validSigningKey: only whsec_ + a real base64 key', () => {
  const k = `whsec_${Buffer.from('k'.repeat(24)).toString('base64')}`
  assert.equal(validSigningKey(`  ${k} `), k)
  assert.equal(validSigningKey(SECRET), null) // a pasted secret token is not a signing key
  assert.equal(validSigningKey('whsec_abc'), null)
  assert.equal(validSigningKey('https://example.com'), null)
})

// ---- what a delivery asks for ----

test('detectProvider: Gitea and Forgejo also send X-GitHub-Event, so they are asked first', () => {
  assert.equal(detectProvider(headers({ 'X-GitHub-Event': 'push' })), 'github')
  assert.equal(detectProvider(headers({ 'X-GitHub-Event': 'push', 'X-Gitea-Event': 'push' })), 'gitea')
  assert.equal(detectProvider(headers({ 'X-GitHub-Event': 'push', 'X-Gitea-Event': 'push', 'X-Forgejo-Event': 'push' })), 'forgejo')
  assert.equal(detectProvider(headers({ 'X-Gitlab-Event': 'Push Hook' })), 'gitlab')
  assert.equal(detectProvider(headers({ 'X-Event-Key': 'repo:push' })), 'bitbucket')
  assert.equal(detectProvider(headers({})), 'generic')
})

test('refMatches: exact branch or tag, never a prefix or a nested name', () => {
  assert.equal(refMatches('refs/heads/main', 'main'), true)
  assert.equal(refMatches('refs/tags/v1.2', 'v1.2'), true)
  assert.equal(refMatches('refs/heads/release/v2', 'release/v2'), true)
  assert.equal(refMatches('refs/heads/main-old', 'main'), false)
  assert.equal(refMatches('refs/heads/feature/main', 'main'), false)
  assert.equal(refMatches('refs/tags/v1.2.1', 'v1.2'), false)
  assert.equal(refMatches('main', 'main'), true) // a generic sender naming the branch bare
  // a clone too old to have recorded its ref follows the default branch
  assert.equal(refMatches('refs/heads/main', 'HEAD', 'main'), true)
  assert.equal(refMatches('refs/heads/dev', 'HEAD', 'main'), false)
  assert.equal(refMatches('refs/heads/main', 'HEAD'), false)
})

const gh = (event: string, payload: object) => {
  const get = headers({ 'X-GitHub-Event': event })
  return decide(parseDelivery('github', get, payload), 'github', 'main')
}

test('branch pushes: the followed branch deploys, others are ignored with the reason', () => {
  assert.deepEqual(gh('push', { ref: 'refs/heads/main', after: 'c'.repeat(40) }), { action: 'deploy', ref: 'refs/heads/main', commit: 'c'.repeat(40) })
  const other = gh('push', { ref: 'refs/heads/dev', after: 'c'.repeat(40) })
  assert.equal(other.action, 'ignore')
  assert.match((other as any).reason, /push to dev, and this stack follows main/)
})

test('tag pushes: deploy a stack that follows that tag, ignored by a branch-following stack', () => {
  const info = parseDelivery('github', headers({ 'X-GitHub-Event': 'push' }), { ref: 'refs/tags/v2.0', after: 'd'.repeat(40) })
  assert.equal(decide(info, 'github', 'v2.0').action, 'deploy')
  assert.equal(decide(info, 'github', 'main').action, 'ignore')
  assert.equal(decide(info, 'github', 'v2').action, 'ignore')
  // GitLab names tag pushes differently
  const gl = parseDelivery('gitlab', headers({ 'X-Gitlab-Event': 'Tag Push Hook' }), { ref: 'refs/tags/v2.0', checkout_sha: 'e'.repeat(40) })
  assert.deepEqual(decide(gl, 'gitlab', 'v2.0'), { action: 'deploy', ref: 'refs/tags/v2.0', commit: 'e'.repeat(40) })
})

test('a push that deletes the followed ref deploys nothing', () => {
  assert.equal(gh('push', { ref: 'refs/heads/main', after: '0'.repeat(40), deleted: true }).action, 'ignore')
  const gl = parseDelivery('gitlab', headers({ 'X-Gitlab-Event': 'Push Hook' }), { ref: 'refs/heads/main', after: '0'.repeat(40) })
  assert.match((decide(gl, 'gitlab', 'main') as any).reason, /deleted main/)
})

test('pings answer, other events are ignored, a known forge must name a ref', () => {
  assert.deepEqual(gh('ping', { zen: 'Keep it logically awesome.' }), { action: 'pong' })
  assert.match((gh('issues', { action: 'opened' }) as any).reason, /"issues" events do not deploy/)
  assert.equal(gh('push', {}).action, 'ignore')
  assert.equal(decide(parseDelivery('gitlab', headers({ 'X-Gitlab-Event': 'Merge Request Hook' }), {}), 'gitlab', 'main').action, 'ignore')
})

test('generic senders: an empty body deploys, a named ref is matched like any push', () => {
  assert.deepEqual(decide(parseDelivery('generic', headers({}), {}), 'generic', 'main'), { action: 'deploy' })
  assert.equal(decide(parseDelivery('generic', headers({}), { ref: 'main' }), 'generic', 'main').action, 'deploy')
  assert.equal(decide(parseDelivery('generic', headers({}), { ref: 'refs/heads/dev' }), 'generic', 'main').action, 'ignore')
})

test('Bitbucket push payloads (Cloud and Data Center)', () => {
  const cloud = parseDelivery('bitbucket', headers({ 'X-Event-Key': 'repo:push' }), {
    push: { changes: [{ new: { type: 'branch', name: 'main', target: { hash: 'f'.repeat(40) } } }] },
  })
  assert.deepEqual(decide(cloud, 'bitbucket', 'main'), { action: 'deploy', ref: 'refs/heads/main', commit: 'f'.repeat(40) })
  const deleted = parseDelivery('bitbucket', headers({ 'X-Event-Key': 'repo:push' }), { push: { changes: [{ new: null, old: { type: 'branch', name: 'main' } }] } })
  assert.equal(decide(deleted, 'bitbucket', 'main').action, 'ignore')
  const dc = parseDelivery('bitbucket', headers({ 'X-Event-Key': 'repo:refs_changed' }), { changes: [{ ref: { id: 'refs/heads/main' }, toHash: 'a'.repeat(40), type: 'UPDATE' }] })
  assert.equal(decide(dc, 'bitbucket', 'main').action, 'deploy')
  assert.deepEqual(decide(parseDelivery('bitbucket', headers({ 'X-Event-Key': 'diagnostics:ping' }), {}), 'bitbucket', 'main'), { action: 'pong' })
})

test('parsePayload: raw JSON, GitHub/Gitea form mode, empty, garbage', () => {
  const json = { ref: 'refs/heads/main' }
  assert.deepEqual(parsePayload(Buffer.from(JSON.stringify(json)), 'application/json'), json)
  const form = Buffer.from(`payload=${encodeURIComponent(JSON.stringify(json))}`)
  assert.deepEqual(parsePayload(form, 'application/x-www-form-urlencoded'), json)
  assert.deepEqual(parsePayload(Buffer.from(''), 'application/json'), {})
  assert.equal(parsePayload(Buffer.from('not json'), 'application/json'), null)
  // curl -d sends a JSON body labelled as a form
  assert.deepEqual(parsePayload(Buffer.from(JSON.stringify(json)), 'application/x-www-form-urlencoded'), json)
  assert.equal(parsePayload(Buffer.from('foo=bar'), 'application/x-www-form-urlencoded'), null)
})

// ---- bursts, rate, auto-sync ----

function fakeTimers() {
  const pending: (() => void)[] = []
  return {
    timers: { set: (fn: () => void) => pending.push(fn), clear: () => {} },
    pending,
    async fire() {
      const fns = pending.splice(0)
      for (const fn of fns) fn()
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
    },
  }
}

test('debounce: a burst of pushes runs one update', async () => {
  const t = fakeTimers()
  const runs: string[] = []
  const c = createCoalescer({ delayMs: 5000, timers: t.timers, run: async (k) => (runs.push(k), 'done') })
  assert.equal(c.trigger('media'), 'scheduled')
  for (let i = 0; i < 4; i++) assert.equal(c.trigger('media'), 'merged')
  assert.equal(t.pending.length, 1) // one timer for the whole burst
  await t.fire()
  assert.deepEqual(runs, ['media'])
  assert.equal(c.phase('media'), 'idle')
  // other stacks are independent
  c.trigger('a')
  c.trigger('b')
  await t.fire()
  assert.deepEqual(runs.sort(), ['a', 'b', 'media'])
})

test('debounce: pushes during a running update queue exactly one more run', async () => {
  const t = fakeTimers()
  let release!: () => void
  let runs = 0
  const c = createCoalescer({
    delayMs: 5000,
    timers: t.timers,
    run: async () => {
      runs++
      if (runs === 1) await new Promise<void>((r) => (release = r))
      return 'done'
    },
  })
  c.trigger('s')
  await t.fire()
  assert.equal(c.phase('s'), 'running')
  assert.equal(c.trigger('s'), 'queued')
  assert.equal(c.trigger('s'), 'queued')
  release()
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
  assert.equal(c.phase('s'), 'waiting') // the follow-up, after its own delay
  await t.fire()
  assert.equal(runs, 2)
  assert.equal(c.phase('s'), 'idle')
})

test('debounce: a busy stack (an update clicked in the UI) is retried, a throwing run does not wedge it', async () => {
  const t = fakeTimers()
  const answers: ('busy' | 'done')[] = ['busy', 'busy', 'done']
  let calls = 0
  const c = createCoalescer({ delayMs: 1, timers: t.timers, run: async () => (calls++, answers.shift()!) })
  c.trigger('s')
  await t.fire()
  await t.fire()
  await t.fire()
  assert.equal(calls, 3)
  assert.equal(c.phase('s'), 'idle')

  const boom = createCoalescer({ delayMs: 1, timers: t.timers, run: async () => { throw new Error('x') } })
  boom.trigger('s')
  await t.fire()
  assert.equal(boom.phase('s'), 'idle')
  assert.equal(boom.trigger('s'), 'scheduled')

  // retries are bounded: a lock that never frees does not spin forever
  const stuck = createCoalescer({ delayMs: 1, maxRetries: 2, timers: t.timers, run: async () => 'busy' })
  stuck.trigger('s')
  for (let i = 0; i < 4; i++) await t.fire()
  assert.equal(stuck.phase('s'), 'idle')
})

test('rateAllow: fixed window per hook', () => {
  let st: { start: number; count: number } | undefined
  for (let i = 0; i < 3; i++) {
    const r = rateAllow(st, 1000 + i, 3, 60_000)
    assert.equal(r.allowed, true)
    st = r.next
  }
  assert.equal(rateAllow(st, 2000, 3, 60_000).allowed, false)
  assert.equal(rateAllow(st, 1000 + 60_000, 3, 60_000).allowed, true) // a new window
})

test('auto-sync: due on its interval, holds a commit that already failed', () => {
  assert.equal(autoSyncDue(undefined, 5, 0), true)
  assert.equal(autoSyncDue(0, 5, 4 * 60_000), false)
  assert.equal(autoSyncDue(0, 5, 5 * 60_000), true)
  assert.equal(autoSyncAction(null, undefined, undefined), 'unreachable')
  assert.equal(autoSyncAction(false, 'abc1234', undefined), 'up-to-date')
  assert.equal(autoSyncAction(true, 'abc1234', undefined), 'deploy')
  // the failed commit is stored full length (a push) or short (a check)
  assert.equal(autoSyncAction(true, 'abc1234', 'abc1234def567'), 'held')
  assert.equal(autoSyncAction(true, 'abc1234', 'abc1234'), 'held')
  // checked out but its compose up failed: still held, never "up to date"
  assert.equal(autoSyncAction(false, 'abc1234', 'abc1234'), 'held')
  // a newer commit is tried again
  assert.equal(autoSyncAction(true, 'fff0000', 'abc1234'), 'deploy')
})

// ---- shared helpers the card uses ----

test('clampSyncInterval: whole minutes within [min, max], default on junk', () => {
  assert.equal(clampSyncInterval(1), AUTO_SYNC_MIN)
  assert.equal(clampSyncInterval(15), 15)
  assert.equal(clampSyncInterval(99999), AUTO_SYNC_MAX)
  assert.equal(clampSyncInterval('abc'), 5)
  assert.equal(clampSyncInterval(-3), 5)
  assert.equal(clampSyncInterval(7.6), 8)
  assert.equal(clampSyncInterval(0.1), AUTO_SYNC_MIN) // too fast is the floor, not the default
})

test('privateHostReason: hosts github.com cannot deliver to', () => {
  for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '172.16.1.1', '172.31.9.9', '192.168.1.20', '169.254.1.1', '100.101.102.103', '[fd12::1]', 'nas.local', 'hub.lan', 'homeport', 'hub.home.arpa', 'box.tail1234.ts.net']) {
    assert.ok(privateHostReason(h), h)
  }
  for (const h of ['hub.example.com', '203.0.113.7', '172.32.0.1', '100.128.0.1', '2001:db8::1', 'example.nl']) {
    assert.equal(privateHostReason(h), null, h)
  }
})

test('guessForge + forgeHooksUrl: the setup tab and the forge page to open', () => {
  assert.equal(guessForge('https://github.com/a/b'), 'github')
  assert.equal(guessForge('https://gitlab.com/a/b'), 'gitlab')
  assert.equal(guessForge('https://gitlab.example.org/a/b'), 'gitlab')
  assert.equal(guessForge('https://codeberg.org/a/b'), 'gitea')
  assert.equal(guessForge('https://git.example.com/a/b'), 'gitea')
  assert.equal(forgeHooksUrl('https://github.com/a/b.git', 'github'), 'https://github.com/a/b/settings/hooks/new')
  assert.equal(forgeHooksUrl('https://gitlab.com/g/sub/p', 'gitlab'), 'https://gitlab.com/g/sub/p/-/hooks')
  assert.equal(forgeHooksUrl('https://git.example.com/a/b/', 'gitea'), 'https://git.example.com/a/b/settings/hooks')
  assert.equal(forgeHooksUrl('https://github.com/a', 'github'), null)
  assert.equal(forgeHooksUrl('not a url', 'github'), null)
})

test('hookPath + deliveryText', () => {
  assert.equal(hookPath('media', 'abc_DEF-123'), '/api/hooks/git/media/abc_DEF-123')
  const base = { at: 0, provider: 'GitHub', event: 'push', ref: 'refs/heads/main', commit: 'a1b2c3d4e5', status: 200, message: '' }
  assert.equal(deliveryText({ ...base, result: 'deployed' }), 'Deployed a1b2c3d from GitHub (push to main).')
  assert.equal(deliveryText({ ...base, result: 'ignored', ref: 'refs/heads/dev', message: 'push to dev, and this stack follows main' }), 'Ignored a push to dev from GitHub: push to dev, and this stack follows main')
  assert.match(deliveryText({ ...base, event: 'ping', result: 'pong' }), /URL and secret work/)
  assert.equal(syncText({ at: 0, result: 'held', commit: '47d9713abc' }), 'Holding: the update to 47d9713 failed, so it is not retried on its own. Push a fix, or use Update from git.')
  assert.equal(syncText({ at: 0, result: 'up-to-date', commit: '47d9713' }), 'Up to date (47d9713).')
})

// ---- who may read the settings, how the result is announced ----

test('a read token or viewer cannot read a stack webhook URL; git info stays readable', () => {
  assert.equal(scopeAllows('read', 'GET', '/api/stacks/media/webhook'), false)
  assert.equal(scopeAllows('read', 'GET', '/api/stacks/media/git'), true)
  assert.equal(scopeAllows('full', 'GET', '/api/stacks/media/webhook'), true)
})

test('alerts name a git deploy as such, not as an auto-update', () => {
  const e = { id: 'git|media', name: 'stack media', host: 'vps', kind: 'updated' as const, from: 'git push', to: '', at: 0 }
  assert.equal(eventText(e), '🟢 stack media updated from git (on push) on vps')
  assert.match(eventText({ ...e, from: 'auto-sync', to: 'exited with code 1' }), /update from git \(auto-sync\) failed: exited with code 1/)
  assert.match(eventText({ ...e, from: 'auto-update' }), /auto-updated/)
})

test('backup: webhook settings come back as they were, bad entries do not', () => {
  const secret = 'a'.repeat(64)
  const good = { media: { hook: { id: 'AbCdEfGhIjKlMnOpQrStUv12', secret, createdAt: 1, signingKey: 'whsec_' + Buffer.alloc(24, 7).toString('base64') }, autoSync: { enabled: true, intervalMin: 15 }, lastDelivery: { at: 1 }, failedCommit: 'abc' } }
  const out = sanitizeWebhookBackup(good)
  assert.deepEqual(Object.keys(out), ['media'])
  assert.equal(out.media.hook?.secret, secret) // the forges keep delivering after a restore
  assert.ok(out.media.hook?.signingKey?.startsWith('whsec_'))
  assert.deepEqual(out.media.autoSync, { enabled: true, intervalMin: 15 })
  assert.equal('lastDelivery' in out.media, false) // run history is not configuration
  assert.equal('failedCommit' in out.media, false)
  // input, even from the admin's own file: nothing malformed reaches a public endpoint
  const bad = sanitizeWebhookBackup({
    '../etc': { hook: { id: 'AbCdEfGhIjKlMnOpQrStUv12', secret } }, // not a stack name
    short: { hook: { id: 'x', secret } }, // id not in the minted shape
    weak: { hook: { id: 'AbCdEfGhIjKlMnOpQrStUv12', secret: 'hunter2' } }, // secret not minted by homeport
    keyed: { hook: { id: 'AbCdEfGhIjKlMnOpQrStUv12', secret, signingKey: 'not-a-key' } },
    sync: { autoSync: { enabled: 'yes', intervalMin: 0 } },
  })
  assert.deepEqual(Object.keys(bad).sort(), ['keyed', 'sync'])
  assert.equal(bad.keyed.hook?.signingKey, undefined) // the hook stays, the bad key is dropped
  assert.equal(bad.sync.autoSync?.enabled, false) // only a real true switches it on
  assert.ok((bad.sync.autoSync?.intervalMin ?? 0) > 0)
  assert.deepEqual(sanitizeWebhookBackup(null), {})
  assert.deepEqual(sanitizeWebhookBackup([1, 2]), {})
})
