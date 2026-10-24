import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot } from './harness.mjs'
const { BASE, page, check, done } = await boot({ port: 3160 })
const wait = (ms) => page.waitForTimeout(ms)
await page.emulateMedia({ colorScheme: 'dark' })
await page.goto(BASE + '/', { waitUntil: 'load' }); await wait(3500)
const main = () => page.locator('main').innerText()
const groupHead = (name) => page.locator('main section:not(.card)').filter({ has: page.locator(`a[href="/stacks/${name}"]`) }).first()

// groups are stacks; no "Other"
const heads = await page.locator('main section h2, main section > div a[href^="/stacks/"]').allInnerTexts()
check('no "Other" group, standalone containers have their own group', !/\bOther\b/.test(await main()) && /Standalone containers/.test(await main()))
// media: counted from the compose file (3 containers + bazarr not created)
const media = await groupHead('media').innerText()
check('media header counts the compose file: 3/4, partly running', /Partly running\s*3\/4/.test(media), media.split('\n').slice(0, 4).join(' | '))
check('a not-running card shows the declared service', /bazarr[\s\S]*Not running/.test(media))
check('subtitle mentions the not-started service', /1 stack service not started/.test(await main()))
check('needs attention lists the partly started stack', /Needs attention[\s\S]*media[\s\S]*bazarr not running/.test(await main()))
check('standalone group has no stack actions', !(await page.locator('main section').filter({ hasText: 'Standalone containers' }).getByRole('button', { name: /Start stack|Restart the stack/ }).count()))
await page.screenshot({ path: join(tmpdir(), 'homeport-e2e-stacks-dash.png'), fullPage: true })

// stack actions from the header: stop the whole "web" stack, it stays visible
const web = groupHead('web')
await web.getByRole('button', { name: 'Stop the stack' }).click(); await wait(300)
await page.getByRole('alertdialog').getByRole('button', { name: 'Stop stack' }).click()
await wait(6000)
const webAfter = await groupHead('web').innerText().catch(() => '')
check('stopped stack stays on the dashboard with a Start button', /Stopped/.test(webAfter) && (await groupHead('web').getByRole('button', { name: /Start stack/ }).count()) === 1, webAfter.split('\n').slice(0, 3).join(' | '))
await groupHead('web').getByRole('button', { name: /Start stack/ }).click(); await wait(6000)
check('start stack brings it back to running', /Running\s*3\/3/.test(await groupHead('web').innerText()))

// stopping one container of a stack explains and offers the stack action
const card = page.locator('main section .card.group').filter({ hasText: 'sonarr' }).first()
await card.hover(); await card.getByRole('button', { name: 'Stop' }).click(); await wait(300)
const dlg = await page.getByRole('alertdialog').innerText()
check('stopping a stack container explains it comes back, offers "Stop the whole stack"',
  /belongs to the stack “media”/.test(dlg) && (await page.getByRole('alertdialog').getByRole('button', { name: 'Stop the whole stack' }).count()) === 1)
await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click(); await wait(200)
// standalone container: plain confirm
const st = page.locator('main section .card.group').filter({ hasText: 'speedtest' }).first()
await st.hover(); await st.getByRole('button', { name: 'Stop' }).click(); await wait(300)
check('standalone container gets the plain stop confirm', (await page.getByRole('alertdialog').getByRole('button', { name: 'Stop the whole stack' }).count()) === 0)
await page.keyboard.press('Escape'); await wait(200)

// container page: stack button + delete offers the compose file
await page.goto(BASE + '/services/demo-1', { waitUntil: 'load' }); await wait(3000)
check('container page links to its stack', await page.getByRole('link', { name: /Stack: media/ }).isVisible())
await page.getByRole('button', { name: /^Delete$/ }).click(); await wait(300)
const del = await page.getByRole('alertdialog').innerText()
check('deleting a stack container says it will be recreated, offers the compose file', /created again/.test(del) && /Open the compose file/.test(del))
await page.getByRole('alertdialog').getByRole('button', { name: 'Open the compose file' }).click(); await wait(1500)
check('…and that choice opens the stack', page.url().endsWith('/stacks/media'), page.url())
const stackPage = await main()
check('stack page lists bazarr as not running', /bazarr[\s\S]*Not running/.test(stackPage) && /3 of 4 services running/.test(stackPage))

// stacks list
await page.goto(BASE + '/stacks', { waitUntil: 'load' }); await wait(2500)
const list = await main()
check('stacks list counts 3/4 for media and names bazarr', /bazarr \(not running\)/.test(list) && /3\/4 running/.test(list))
check('renamed: "Stacks homeport can\'t edit"', /Stacks homeport can't edit/.test(list))
await done()
