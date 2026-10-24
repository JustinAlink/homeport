import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot } from './harness.mjs'
// screenshots for eyeballing a failed run, kept out of the repo
const S = join(tmpdir(), 'homeport-e2e-shots/')
mkdirSync(S, { recursive: true })
// A) all caps, desktop screenshots of new UI
{
  const { BASE, page, check, done } = await boot({ port: 3130 })
  const wait = (ms) => page.waitForTimeout(ms)
  await page.goto(BASE + '/', { waitUntil: 'load' }); await wait(2500)
  const card = page.locator('main section .card.group').filter({ hasText: 'jellyfin' }).first()
  await card.hover(); await card.getByRole('button', { name: 'Pin jellyfin' }).click(); await wait(400)
  await page.mouse.move(5, 5)
  await page.screenshot({ path: S + 'dash-pinned.png' })
  await page.keyboard.press('Control+k'); await wait(200); await page.keyboard.type('sonarr'); await wait(400)
  await page.screenshot({ path: S + 'palette-verbs.png' })
  await page.keyboard.press('Escape'); await wait(300)
  await page.keyboard.press('?'); await wait(400)
  await page.screenshot({ path: S + 'shortcuts.png' })
  await page.keyboard.press('Escape'); await wait(400)
  await page.goto(BASE + '/settings?tab=monitoring', { waitUntil: 'load' }); await wait(2000)
  await page.screenshot({ path: S + 'settings-monitoring.png', fullPage: true })
  await page.goto(BASE + '/services/demo-0', { waitUntil: 'load' }); await wait(2500)
  await page.locator('#restart-policy').selectOption('always'); await page.locator('#mem-limit').fill('2g'); await wait(300)
  await page.screenshot({ path: S + 'service-writethrough.png' })
  await page.goto(BASE + '/login', { waitUntil: 'load' })
  await done()
}
// B) stacks + proxy admin off: gates
{
  const { BASE, page, check, done } = await boot({ port: 3131, env: { HOMEPORT_ALLOW_STACKS: 'false', HOMEPORT_ALLOW_PROXY_ADMIN: 'false' } })
  const wait = (ms) => page.waitForTimeout(ms)
  await page.goto(BASE + '/storage', { waitUntil: 'load' }); await wait(2500)
  const nav = await page.locator('aside nav').innerText()
  check('switched-off pages stay in the sidebar marked "off"', /Storage\s*off/i.test(nav) && /Domains\s*off/i.test(nav), nav.replace(/\s+/g, ' '))
  check('a switched-off page explains how to turn it on', await page.getByText('Storage management is turned off').isVisible() && await page.getByRole('link', { name: 'Turn it on in Settings' }).isVisible())
  await page.screenshot({ path: S + 'gate.png' })
  await done()
}
// C) viewer account
{
  const { BASE, page, check, done, ctx } = await boot({ port: 3132 })
  const wait = (ms) => page.waitForTimeout(ms)
  const created = await page.request.post(`${BASE}/api/users`, { data: { username: 'teammate', password: 'viewer-pass-123' } })
  await ctx.clearCookies()
  await page.goto(BASE + '/login', { waitUntil: 'load' }); await wait(800)
  check('login username defaults to admin', (await page.getByLabel('Username').inputValue()) === 'admin')
  await page.getByLabel('Username').fill('teammate'); await page.getByLabel('Password').fill('viewer-pass-123')
  await page.getByRole('button', { name: 'Sign in' }).click(); await wait(2500)
  check('viewer can sign in', page.url().endsWith('/') , `${created.status()} ${page.url()}`)
  const nav = await page.locator('aside nav').innerText()
  check('viewer sidebar has no Settings and no "off" items', !/Settings/.test(nav) && !/\boff\b/i.test(nav), nav.replace(/\s+/g, ' '))
  const actionButtons = await page.locator('main section .card.group button[aria-label^="Restart"], main section .card.group button[aria-label^="Stop"]').count()
  check('viewer sees no restart/stop buttons', actionButtons === 0, String(actionButtons))
  await page.goto(BASE + '/services/demo-0', { waitUntil: 'load' }); await wait(2000)
  check('viewer: no Restart/Stop on the container page', (await page.getByRole('button', { name: /^Restart$|^Stop$/ }).count()) === 0)
  await page.screenshot({ path: S + 'viewer-service.png' })
  // admin via "admin" username
  await ctx.clearCookies()
  await page.goto(BASE + '/login', { waitUntil: 'load' }); await wait(800)
  await page.getByLabel('Password').fill('pw-test'); await page.getByRole('button', { name: 'Sign in' }).click(); await wait(2000)
  check('"admin" + admin password signs in as admin', page.url().endsWith('/') && (await page.locator('aside nav').innerText()).includes('Settings'))
  await done()
}
// D) phone with touch
{
  const { BASE, page, check, done } = await boot({ port: 3133, viewport: { width: 390, height: 844 }, hasTouch: true })
  const wait = (ms) => page.waitForTimeout(ms)
  await page.goto(BASE + '/', { waitUntil: 'load' }); await wait(2500)
  const visibleRestart = await page.locator('main section .card.group').filter({ hasText: 'jellyfin' }).first().getByRole('button', { name: 'Restart' }).first().isVisible()
  check('touch: card actions are visible without hover', visibleRestart)
  await page.locator('main section').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: S + 'touch-cards.png' })
  await done()
}
