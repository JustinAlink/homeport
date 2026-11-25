// Deploy on push in demo mode: the card on a git stack's page (URL, secret shown
// once, per-forge setup, last delivery, auto-sync), the public delivery endpoint
// (signed = ok, unsigned or wrong = 401, other ref = 202, unknown = 404) and the
// activity feed line. Demo deliveries are verified for real and deploy nothing.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { boot } from './harness.mjs'

const { BASE, page, check, done } = await boot({ port: 3332, env: { HOMEPORT_ALLOW_GIT_WEBHOOKS: 'true' } })
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const wait = (ms) => page.waitForTimeout(ms)
const card = () => page.locator('section[aria-labelledby="deploy-on-push-title"]')
const sign = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
// plain fetch: no cookie, no session, exactly what a forge sends
const deliver = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': 'push', ...headers }, body })

async function cardAxe(scheme) {
  await page.emulateMedia({ colorScheme: scheme })
  await page.reload({ waitUntil: 'load' }); await wait(2500)
  await page.addScriptTag({ content: axe })
  const v = await page.evaluate(async () =>
    (await window.axe.run('section[aria-labelledby="deploy-on-push-title"]', { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  )
  check(`card: no WCAG A/AA violations (${scheme})`, v.length === 0, v.slice(0, 3).join(' | '))
}

try {
  await page.goto(BASE + '/stacks/media', { waitUntil: 'load' }); await wait(3000)
  check('card renders on a git stack', (await card().count()) === 1)
  const urlInput = card().getByRole('textbox', { name: 'Payload URL' })
  const hookUrl = await urlInput.inputValue()
  check('payload URL is this origin + /api/hooks/git/media/<id>', hookUrl.startsWith(`${BASE}/api/hooks/git/media/`), hookUrl)
  check('loopback origin gets the "cannot reach this URL" warning', /cannot reach this URL/.test(await card().innerText()))
  check('demo shows a past delivery', /Deployed a1b2c3d from GitHub \(push to main\)/.test(await card().innerText()))
  check('the secret is not on the page before it is regenerated', !/[0-9a-f]{64}/.test(await card().innerText()) && (await card().getByRole('textbox', { name: 'Secret' }).count()) === 0)
  const view = await (await page.request.get(BASE + '/api/stacks/media/webhook')).json()
  check('GET never returns the secret', !JSON.stringify(view).match(/[0-9a-f]{64}/) && !('secret' in view) && !('secret' in (view.hook || {})))

  // regenerate: confirm, then the secret shows once
  await card().getByRole('button', { name: 'Regenerate secret' }).click(); await wait(300)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerate' }).click(); await wait(1200)
  const secretBox = card().getByRole('textbox', { name: 'Secret' })
  const secret = await secretBox.inputValue()
  check('regenerate shows a 64-hex secret', /^[0-9a-f]{64}$/.test(secret), secret)
  check('…focused, ready to copy', await secretBox.evaluate((el) => document.activeElement === el))

  // the public endpoint
  const body = JSON.stringify({ ref: 'refs/heads/main', after: 'e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d' })
  let r = await deliver(hookUrl, body, { 'x-hub-signature-256': sign(secret, body) })
  let j = await r.json()
  check('signed POST (demo): 200 ok, nothing deployed', r.status === 200 && j.ok === true && j.demo === true, `${r.status} ${JSON.stringify(j)}`)
  r = await deliver(hookUrl, body)
  check('unsigned POST: 401', r.status === 401, String(r.status))
  r = await deliver(hookUrl, body, { 'x-hub-signature-256': sign(secret, body + ' ') })
  check('signature over another body: 401', r.status === 401, String(r.status))
  r = await deliver(hookUrl, body, { 'x-hub-signature-256': sign('a'.repeat(64), body) })
  check('wrong secret: 401', r.status === 401, String(r.status))
  const dev = JSON.stringify({ ref: 'refs/heads/dev', after: 'f'.repeat(40) })
  r = await deliver(hookUrl, dev, { 'x-hub-signature-256': sign(secret, dev) })
  j = await r.json()
  check('push to another branch: 202 with the reason', r.status === 202 && /follows main/.test(j.reason), `${r.status} ${JSON.stringify(j)}`)
  r = await deliver(hookUrl.replace(/[^/]+$/, 'AAAAAAAAAAAAAAAAAAAAAAAA'), body, { 'x-hub-signature-256': sign(secret, body) })
  const wrongId = r.status
  r = await deliver(`${BASE}/api/hooks/git/nosuchstack/AAAAAAAAAAAAAAAAAAAAAAAA`, body)
  check('unknown id and unknown stack: the same 404', wrongId === 404 && r.status === 404, `${wrongId} ${r.status}`)
  r = await fetch(hookUrl)
  check('GET on the hook URL still needs a session', r.status === 401, String(r.status))
  const gl = await deliver(hookUrl, body, { 'x-github-event': '', 'x-gitlab-event': 'Push Hook', 'x-gitlab-token': secret })
  check('GitLab secret token accepted', gl.status === 200, String(gl.status))

  // the card reports the last delivery (rejections included, with why)
  r = await deliver(hookUrl, body, { 'x-hub-signature-256': sign('b'.repeat(64), body) })
  await card().getByRole('button', { name: 'I have copied it' }).click()
  await page.reload({ waitUntil: 'load' }); await wait(2500)
  check('last delivery: the rejection and its reason', /Rejected a delivery from GitHub: X-Hub-Signature-256 does not match/.test(await card().innerText()))
  check('…with the status homeport answered', (await card().getByText('401', { exact: true }).count()) === 1)
  check('the secret is gone after a reload (shown once)', (await card().getByRole('textbox', { name: 'Secret' }).count()) === 0)

  // per-forge setup steps
  await card().getByRole('button', { name: 'GitLab' }).click(); await wait(200)
  check('GitLab tab: pressed, its own field names', (await card().getByRole('button', { name: 'GitLab' }).getAttribute('aria-pressed')) === 'true' && /Secret token/.test(await card().innerText()))
  check('…and a link to the repository webhook settings', (await card().getByRole('link', { name: /webhook settings/ }).getAttribute('href')) === 'https://github.com/example/media-stack/-/hooks')
  await card().getByRole('textbox', { name: /GitLab signing token/ }).fill('not-a-token')
  await card().getByRole('button', { name: 'Save', exact: true }).click(); await wait(800)
  check('a pasted secret token is refused as signing token', /not a GitLab signing token/.test(await page.locator('body').innerText()))
  await card().getByRole('button', { name: 'Other' }).click(); await wait(200)
  check('Other tab: header names and a curl line', /X-Homeport-Secret/.test(await card().innerText()) && /curl -X POST/.test(await card().innerText()))

  // auto-sync
  await card().getByRole('checkbox', { name: 'Update when the repository moves' }).check(); await wait(900)
  await card().getByRole('combobox', { name: 'Check every' }).selectOption('15'); await wait(900)
  const v2 = await (await page.request.get(BASE + '/api/stacks/media/webhook')).json()
  check('auto-sync saved: on, every 15 min', v2.autoSync.enabled === true && v2.autoSync.intervalMin === 15, JSON.stringify(v2.autoSync))
  check('header badge says so', /auto-sync every 15 min/.test(await card().innerText()))
  const tooFast = await page.request.post(BASE + '/api/stacks/media/webhook', { data: { op: 'auto-sync', enabled: true, intervalMin: 0.1 } })
  check('the server keeps the 2 minute floor', (await tooFast.json()).autoSync.intervalMin === 2)

  await cardAxe('dark')
  await cardAxe('light')

  // remove, then the old URL is gone; create gives a new URL and secret
  await card().getByRole('button', { name: 'Remove webhook' }).click(); await wait(300)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove webhook' }).click(); await wait(1000)
  r = await deliver(hookUrl, body, { 'x-hub-signature-256': sign(secret, body) })
  check('removed: the old URL answers 404', r.status === 404, String(r.status))
  await card().getByRole('button', { name: 'Create webhook' }).click(); await wait(1200)
  const fresh = await card().getByRole('textbox', { name: 'Secret' }).inputValue()
  const freshUrl = await card().getByRole('textbox', { name: 'Payload URL' }).inputValue()
  check('create: a new URL and a new secret', freshUrl !== hookUrl && /^[0-9a-f]{64}$/.test(fresh) && fresh !== secret)

  // a viewer-scope reader never sees the URL
  const tok = await (await page.request.post(BASE + '/api/tokens', { data: { name: 'e2e-read', scope: 'read' } })).json()
  r = await fetch(`${BASE}/api/stacks/media/webhook`, { headers: { authorization: `Bearer ${tok.token}` } })
  check('read-scope token: 403 on the webhook settings', r.status === 403, String(r.status))

  // a stack that is not from git has no card
  await page.goto(BASE + '/stacks/web', { waitUntil: 'load' }); await wait(2500)
  check('non-git stack: no card', (await card().count()) === 0)

  // the activity feed names push deploys
  await page.goto(BASE + '/activity', { waitUntil: 'load' }); await wait(2000)
  check('activity: "stack media updated from git (on push)"', /stack media updated from git \(on push\)/.test(await page.locator('main').innerText()))

  // settings: the capability, locked by the env var here
  await page.goto(BASE + '/settings?tab=capabilities', { waitUntil: 'load' }); await wait(2000)
  const cap = page.getByRole('checkbox', { name: /Deploy git stacks on push/ })
  check('settings: the webhook capability, on and locked by HOMEPORT_ALLOW_GIT_WEBHOOKS', (await cap.isChecked()) && (await cap.isDisabled()) && /HOMEPORT_ALLOW_GIT_WEBHOOKS/.test(await page.locator('main').innerText()))
} catch (e) {
  check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | '))
}
await done()
