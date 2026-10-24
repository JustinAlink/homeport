import { boot } from './harness.mjs'
const { BASE, page, check, done } = await boot({ port: 3214 })
const wait = (ms) => page.waitForTimeout(ms)
try {
  // the stack page shows the owner and warns before a hand edit
  await page.goto(BASE + '/stacks/downloads', { waitUntil: 'load' }); await wait(3500)
  let t = await page.locator('main').innerText()
  check('managed stack: "managed by" badge', /managed by ansible playbook/.test(t))
  check('managed stack: editor warns before editing', /managed by ansible playbook: its next run overwrites changes/.test(t))
  await page.locator('main .cm-content').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' # hotfix'); await wait(200)
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await wait(400)
  check('saving asks first', (await page.getByRole('alertdialog').count()) === 1)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click(); await wait(300)
  // homeport's own writes are refused
  const r = await page.request.post(BASE + '/api/stacks/downloads/service-settings', { data: { service: 'gluetun', restart: 'always' } })
  check('server refuses automatic compose writes (409)', r.status() === 409, String(r.status()))
  // the container page offers no "save to compose" and says where to change it
  await page.goto(BASE + '/services/demo-10', { waitUntil: 'load' }); await wait(3000)
  check('container page: hint names the owner', /managed by ansible playbook/.test(await page.locator('main').innerText()))
  await page.locator('.card', { hasText: 'Start on boot' }).locator('select').selectOption('always'); await wait(300)
  check('container page: no "also save to compose" option', !(await page.getByText(/Also save it to/).count()))
  // the version switch points at the owner
  await page.goto(BASE + '/updates', { waitUntil: 'load' }); await wait(3500)
  const row = page.locator('section').filter({ hasText: 'Newer versions' }).locator('.row-list > div').filter({ hasText: 'gluetun' })
  check('newer versions: no switch, "change it in ansible playbook"', (await row.getByRole('button', { name: /Switch to/ }).count()) === 0 && /change it in ansible playbook/.test(await row.innerText()))
  // control: a normal stack still offers the switch
  const prow = page.locator('section').filter({ hasText: 'Newer versions' }).locator('.row-list > div').filter({ hasText: 'portainer' })
  check('control: an ordinary stack still offers the switch', (await prow.getByRole('button', { name: /Switch to/ }).count()) >= 1)
  // the dashboard chart labels its scale; the 2FA nudge stays out of demo mode
  await page.goto(BASE + '/', { waitUntil: 'load' }); await wait(3000)
  check('dashboard: no 2FA nudge in demo mode', !(await page.getByText('Two-factor sign-in is off').count()))
  check('dashboard chart labels its scale', (await page.locator('main svg text').filter({ hasText: /%$/ }).count()) >= 2)
} catch (e) { check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | ')) }
await done()
