// Alert silences and certificate chips in demo mode: snooze from a service page,
// the banner, pause and resume, maintenance windows saved with the settings, and
// a viewer who can see silences but not change them.
import { boot } from './harness.mjs'

const { BASE, page, check, done, ctx } = await boot({ port: 3353 })
const wait = (ms) => page.waitForTimeout(ms)
const banner = () => page.locator('main > div[role="status"]').filter({ hasText: /snoozed|paused|Maintenance/ })
try {
  // snooze one app from its page
  await page.goto(BASE + '/services/demo-0', { waitUntil: 'load' }); await wait(2500)
  await page.getByRole('button', { name: 'Snooze alerts' }).click(); await wait(300)
  check('menu opens with presets', (await page.getByRole('menuitem').count()) === 5)
  await page.keyboard.press('Escape'); await wait(200)
  check('Escape closes the menu', (await page.getByRole('menu').count()) === 0)
  await page.getByRole('button', { name: 'Snooze alerts' }).click(); await wait(300)
  await page.getByRole('menuitem', { name: 'Until it recovers' }).click(); await wait(1500)
  check('header says snoozed until it recovers', await page.getByText('Snoozed until it recovers', { exact: true }).isVisible())
  check('banner counts one snoozed app', (await banner().innerText()).includes('1 app snoozed'))
  await page.goto(BASE + '/', { waitUntil: 'load' }); await wait(3000)
  check('dashboard card shows the bell', (await page.getByRole('img', { name: /Alerts snoozed until it recovers/ }).count()) >= 1)

  // pause everything from settings, resume from the banner
  await page.goto(BASE + '/settings?tab=monitoring', { waitUntil: 'load' }); await wait(2000)
  const silences = page.locator('#silences')
  check('snoozed app listed in settings', (await silences.innerText()).includes('jellyfin'))
  await silences.getByRole('button', { name: '1 hour' }).click(); await wait(1200)
  check('banner says all alerts paused', (await banner().innerText()).includes('All alerts paused'))
  await banner().getByRole('button', { name: 'Resume alerts' }).click(); await wait(1200)
  check('resume clears the pause', !(await banner().innerText()).includes('paused'))
  await silences.getByRole('button', { name: 'Resume' }).click(); await wait(1200)
  check('resume the snooze from settings', (await banner().count()) === 0)

  // a maintenance window: validation, then saved with the page
  await silences.getByRole('button', { name: 'Add window' }).click(); await wait(300)
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) await silences.getByRole('button', { name: d, exact: true }).click()
  check('no day picked is explained', (await silences.getByRole('alert').innerText()).includes('at least one day'))
  await silences.getByRole('button', { name: 'Sat', exact: true }).click()
  await silences.getByLabel('What happens then').fill('weekly backups')
  await page.getByRole('button', { name: /^Save/ }).first().click(); await wait(1500)
  const saved = await (await page.request.get(BASE + '/api/alerts/silences')).json()
  check('window saved', saved.windows.length === 1 && saved.windows[0].days.join() === '6' && saved.windows[0].note === 'weekly backups', JSON.stringify(saved.windows))
  check('time zone is reported for the editor', typeof saved.timeZone === 'string' && saved.timeZone.length > 0)
  const bad = await page.request.post(BASE + '/api/settings', { data: { maintenanceWindows: [{ days: [], start: '02:00', end: '04:00' }] } })
  check('an empty window is refused by the server', bad.status() === 400, String(bad.status()))

  // certificates
  await page.goto(BASE + '/domains', { waitUntil: 'load' }); await wait(2500)
  const domains = await page.locator('main').innerText()
  check('domains show certificate state', domains.includes('cert 5 days left') && domains.includes('cert self-signed'))

  // a viewer sees silences but cannot change them
  await page.request.post(`${BASE}/api/users`, { data: { username: 'watcher', password: 'viewer-pass-123' } })
  await ctx.clearCookies()
  await page.goto(BASE + '/login', { waitUntil: 'load' }); await wait(800)
  await page.getByLabel('Username').fill('watcher'); await page.getByLabel('Password').fill('viewer-pass-123')
  await page.getByRole('button', { name: 'Sign in' }).click(); await wait(2500)
  const snooze = await page.request.post(BASE + '/api/alerts/snooze', { data: { key: 'default|jellyfin', until: Date.now() + 3600_000 } })
  check('viewer cannot snooze', snooze.status() === 403, String(snooze.status()))
  await page.goto(BASE + '/services/demo-0', { waitUntil: 'load' }); await wait(2500)
  check('viewer has no snooze button', (await page.getByRole('button', { name: 'Snooze alerts' }).count()) === 0)
} catch (e) {
  check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | '))
}
await done()
