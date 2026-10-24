import { boot } from './harness.mjs'
const { BASE, page, check, done } = await boot({ port: 3213 })
const wait = (ms) => page.waitForTimeout(ms)
try {
  // git stack (media): compose.yaml is tracked
  await page.goto(BASE + '/stacks/media', { waitUntil: 'load' }); await wait(3500)
  check('git stack: the compose editor warns before editing', /comes from the git repository[\s\S]*commit it to main/.test(await page.locator('main').innerText()))
  await page.locator('main .cm-content').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' # local tweak'); await wait(200)
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await wait(400)
  const dlg = page.getByRole('alertdialog')
  check('saving a tracked file asks first', (await dlg.count()) === 1 && /Save compose\.yaml here\?/.test(await dlg.innerText()))
  await dlg.getByRole('button', { name: 'Cancel' }).click(); await wait(400)
  let st = await (await page.request.get(BASE + '/api/stacks/media')).json()
  check('cancel leaves the file alone', !st.content.includes('local tweak'))
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await wait(300)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save anyway' }).click(); await wait(1500)
  st = await (await page.request.get(BASE + '/api/stacks/media')).json()
  check('"Save anyway" saves', st.content.includes('local tweak'))
  await page.locator('main .cm-content').first().click(); await page.keyboard.press('End'); await page.keyboard.type('2'); await wait(200)
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await wait(1200)
  check('asked once per file: the second save goes straight through', (await page.getByRole('alertdialog').count()) === 0 && (await (await page.request.get(BASE + '/api/stacks/media')).json()).content.includes('local tweak2'))
  // file editor: an untracked .env has no warning
  await page.getByRole('button', { name: /\.env/ }).first().click(); await wait(1200)
  check('untracked .env: no warning', !(await page.getByRole('dialog').getByText(/comes from the git repository/).count()))
  await page.getByRole('button', { name: 'Close' }).click(); await wait(400)
  await page.locator('main section').filter({ hasText: 'Files' }).getByRole('button', { name: /compose\.yaml/ }).first().click(); await wait(1200)
  check('tracked compose.yaml in the file browser: warning shown (control)', (await page.getByRole('dialog').getByText(/comes from the git repository/).count()) === 1)
  await page.getByRole('button', { name: 'Close' }).click(); await wait(400)
  // non-git stack: nothing
  await page.goto(BASE + '/stacks/web', { waitUntil: 'load' }); await wait(3000)
  check('non-git stack: no warning', !/comes from the git repository/.test(await page.locator('main').innerText()))
} catch (e) { check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | ')) }
await done()
