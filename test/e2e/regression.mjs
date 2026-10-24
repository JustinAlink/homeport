import { boot } from './harness.mjs'
// its connection-lost check aborts /api/version on purpose
const { BASE, page, check, done } = await boot({ allowErrors: [/net::ERR_FAILED/] })
const wait = (ms) => page.waitForTimeout(ms)
const go = async (p, ms = 2500) => { await page.goto(BASE + p, { waitUntil: 'load' }); await wait(ms) }

// 1 stopped filter
await go('/')
const stoppedBtn = await page.getByRole('button', { name: /^Stopped/ }).innerText()
await page.getByRole('button', { name: /^Stopped/ }).click(); await wait(300)
const stoppedNames = await page.locator('main section .card.group a[href^="/services/"]').allInnerTexts()
check('Stopped filter excludes the restarting container', !stoppedNames.some((n) => /watchtower/.test(n)) && stoppedNames.length >= 1, stoppedBtn.replace(/\s+/g, ' ') + ' → ' + stoppedNames.join(','))

// 2 URL state survives Back
await page.getByRole('button', { name: /^Issues/ }).click(); await wait(300)
await page.locator('main section .card.group').first().click({ position: { x: 150, y: 20 } }); await wait(1500)
await page.goBack(); await wait(1500)
check('Back restores the status filter', page.url().includes('status=issues') && (await page.getByRole('button', { name: /^Issues/ }).getAttribute('aria-pressed')) === 'true', page.url())
await go('/')

// 3 pin
const card = page.locator('main section .card.group').filter({ hasText: 'sonarr' }).first()
await card.hover(); await card.getByRole('button', { name: 'Pin sonarr' }).click(); await wait(300)
check('pinning adds a Pinned group', await page.getByRole('heading', { name: /Pinned/ }).isVisible())
await page.reload(); await wait(2000)
check('pin survives a reload', await page.getByRole('heading', { name: /Pinned/ }).isVisible())

// 4 keyboard focus reveals actions
const first = page.locator('main section .card.group').nth(1)
await first.locator('a').first().focus()
await page.keyboard.press('Tab'); await wait(200)
const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent)
const overlayOpacity = await page.evaluate(() => getComputedStyle(document.activeElement.closest('div.absolute') || document.activeElement).opacity)
check('Tab into a card shows its quick actions', overlayOpacity === '1', `${focusedLabel} opacity=${overlayOpacity}`)

// 5 palette verbs
await page.keyboard.press('Escape')
await page.locator('body').click({ position: { x: 5, y: 890 } })
await page.keyboard.press('Control+k'); await wait(300)
await page.keyboard.type('jelly logs'); await wait(300)
const firstResult = await page.locator('[role=dialog] button[data-idx="0"]').innerText()
await page.keyboard.press('Enter'); await wait(1500)
check('palette "jelly logs" opens the logs tab', page.url().includes('tab=logs'), firstResult.split('\n')[0] + ' → ' + page.url())
await page.keyboard.press('Control+k'); await wait(300)
await page.keyboard.type('restart sonarr'); await wait(300)
const r2 = await page.locator('[role=dialog] button[data-idx="0"]').innerText()
await page.keyboard.press('Enter'); await wait(1200)
const toast = await page.locator('[role=status]').allInnerTexts()
check('palette "restart sonarr" restarts it', /sonarr: restarted/.test(toast.join(' ')), r2.split('\n')[0] + ' / ' + toast.join(' | '))

// 6 ? and g s
await go('/', 1500)
await page.keyboard.press('?'); await wait(300)
check('? opens the shortcut sheet', await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).isVisible())
await page.keyboard.press('Escape'); await wait(700)
check('Esc closes it', (await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count()) === 0)
await page.keyboard.press('g'); await page.keyboard.press('s'); await wait(1200)
check('g then s goes to Stacks', page.url().endsWith('/stacks'), page.url())

// 7 focus trap in confirm dialog
await go('/services/demo-1')
await page.getByRole('button', { name: /^Stop$/ }).click(); await wait(300)
let inside = true
for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); inside = inside && (await page.evaluate(() => !!document.activeElement?.closest('[role=alertdialog]'))) }
check('Tab stays inside the confirm dialog', inside)
await page.keyboard.press('Escape'); await wait(200)

// 8 settings labels + no false proxy hint in demo
await go('/settings')
check('no "no reverse proxy" hint when one is detected', (await page.getByText('No reverse proxy is configured yet').count()) === 0)
await page.getByLabel('Remote over SSH').check(); await wait(200)
check('SSH fields have real labels', await page.getByLabel('SSH address').isVisible() && await page.getByLabel('Private key path').isVisible())
await page.getByLabel('Local socket / proxy').check(); await wait(200)

// 9 stack actions dedupe
await go('/stacks/infra')
const infraButtons = await page.locator('main header').innerText()
check('infra: "Update stack" shown, duplicate "Pull & up" hidden', /Update stack \(1\)/.test(infraButtons) && !/Pull & up/.test(infraButtons), infraButtons.replace(/\s+/g, ' ').slice(0, 120))

// 10 type-to-confirm on delete with volumes
await go('/stacks/web')
await page.getByRole('button', { name: 'Delete stack' }).click(); await wait(200)
await page.getByText(/Also delete its named volumes/).click()
await page.getByRole('button', { name: 'Delete permanently' }).click(); await wait(300)
const confirmBtn = page.getByRole('alertdialog').getByRole('button', { name: 'Delete stack and data' })
const disabledBefore = await confirmBtn.isDisabled()
await page.getByLabel(/Type .* to confirm/).fill('web'); await wait(100)
const enabledAfter = await confirmBtn.isEnabled()
check('deleting with volumes needs the stack name typed', disabledBefore && enabledAfter)
await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()

// 11 unsaved guard on the compose editor
await go('/stacks/web')
await page.locator('.cm-content').click(); await page.keyboard.press('End'); await page.keyboard.type(' ')
await page.locator('aside').getByRole('link', { name: 'Dashboard' }).click(); await wait(400)
const guard = await page.getByRole('alertdialog').innerText().catch(() => '')
check('leaving with unsaved compose edits asks first', /Leave without saving/.test(guard))
await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click(); await wait(200)
check('cancel stays on the stack', page.url().endsWith('/stacks/web'))
await page.keyboard.press('Control+z')

// 12 activity links
await go('/activity')
const link = await page.locator('main ol a').first().getAttribute('href').catch(() => null)
check('activity rows link to what they are about', !!link, link || 'none')

// 13 catalog fallback
await go('/catalog?q=zzzqqq', 3500)
await page.getByRole('button', { name: 'Search Docker Hub' }).click(); await wait(800)
check('no-match search carries over to Docker Hub', page.url().includes('tab=hub') && (await page.locator('input[placeholder^="Search all of Docker Hub"]').inputValue()) === 'zzzqqq', page.url())

// 14 compose write-through (web: not git-backed, so homeport may write its file)
await go('/services/demo-3')
await page.locator('#restart-policy').selectOption('always'); await wait(200)
const cbVisible = await page.getByText(/Also save it to/).isVisible()
await page.getByRole('button', { name: 'Apply', exact: true }).click(); await wait(1200)
const msg = await page.locator('main').innerText()
const stack = await page.request.get(`${BASE}/api/stacks/web`).then((r) => r.json())
check('restart policy is written into the compose file', cbVisible && /Saved to compose\.yaml/.test(msg) && /ghost:[\s\S]*?restart: always/.test(stack.content), (msg.match(/Applied[^\n]*/) || [''])[0])

// 15 logs highlight + wrap
await go('/services/demo-0?tab=logs', 3000)
const sample = (await page.locator('main .font-mono span').nth(1).innerText().catch(() => '')).slice(0, 4)
await page.getByLabel('Filter log lines').fill(sample || 'a'); await wait(300)
check('log filter highlights matches', (await page.locator('main mark').count()) > 0, `needle "${sample}"`)
await page.getByRole('button', { name: 'Wrap' }).click()
check('wrap toggles', (await page.getByRole('button', { name: 'Wrap' }).getAttribute('aria-pressed')) === 'false')

// 16 connection banner
await go('/', 1500)
await page.route('**/api/version', (r) => r.abort())
await wait(23000)
check('lost connection shows the banner', await page.getByText('Lost the connection to homeport').isVisible())
await page.unroute('**/api/version')
let cleared = false, toasted = false
for (let i = 0; i < 40 && !cleared; i++) { await wait(500); toasted = toasted || (await page.getByText('Reconnected to homeport').count()) > 0; cleared = !(await page.getByText('Lost the connection to homeport').isVisible()) }
await wait(300); toasted = toasted || (await page.getByText('Reconnected to homeport').count()) > 0
check('banner clears and says reconnected', cleared && toasted, `cleared=${cleared} toast=${toasted}`)

// 17 tab title count
check('tab title shows the problem count', /^\(\d+\) homeport$/.test(await page.title()), await page.title())
await done()
