// The public status page in demo mode: what a visitor without an account sees at
// /status (fresh browser context, no cookies), what its JSON may hold, the day
// bars by keyboard, editing it in Settings, and "off" looking exactly like a page
// that never existed (for the page and for its API).
import { boot } from './harness.mjs'

const { BASE, page, ctx, check, done } = await boot({ port: 3343 })
const wait = (ms) => page.waitForTimeout(ms)
const browser = ctx.browser()
// a visitor: its own context, so no session cookie and no stored theme
async function visitor(opts = {}) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts })
  const p = await c.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
  const apis = []
  p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) apis.push(u.pathname) })
  return { c, p, errs, apis }
}
const settingsSaved = () => page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'POST')

try {
  // ---- a visitor with no session ----
  const v = await visitor()
  await v.p.clock.install() // time runs as usual; runFor below skips ahead to the next refresh
  const res = await v.p.goto(BASE + '/status', { waitUntil: 'load' }); await v.p.waitForTimeout(1500)
  check('anonymous /status answers 200', res.status() === 200, String(res.status()))
  check('…and stays on /status (no login redirect)', new URL(v.p.url()).pathname === '/status', v.p.url())
  check('…titled with the page title only', (await v.p.title()) === 'Home server status', await v.p.title())
  const main = await v.p.locator('main').innerText()
  check('…shows the overall headline', main.includes('All systems operational'))
  check('…the maintenance notice', main.includes('Jellyfin gets its update on Sunday evening'))
  check('…the three groups in order', JSON.stringify(await v.p.locator('main h2').allInnerTexts()) === JSON.stringify(['Watch and listen', 'Websites', 'Downloads']), JSON.stringify(await v.p.locator('main h2').allInnerTexts()))
  check('…the picked names', ['Movies and TV', 'Blog', 'Password manager', 'Download manager', 'VPN tunnel'].every((n) => main.includes(n)))
  check('…a domain item shows its domain', main.includes('vault.example.com'))
  check('…uptime for 24 h, 7 d and 30 d', ['24 hours', '7 days', '30 days'].every((w) => main.includes(w)) && /\d+(\.\d+)?%/.test(main))
  check('…30 day bars per item', (await v.p.locator('[role="slider"]').first().locator('span').count()) === 30)
  check('…no admin shell (sidebar, menu, search)', (await v.p.locator('aside, nav[aria-label="Main"]').count()) === 0)
  check('…a single small "powered by" link to the project, not to this admin', (await v.p.getByRole('link', { name: 'homeport' }).getAttribute('href')) === 'https://github.com/JustinAlink/homeport')
  check('…no link into the admin app', (await v.p.locator('a[href^="/"]').count()) === 0)
  check('…only the public API was asked', v.apis.length > 0 && v.apis.every((p) => p === '/api/public/status'), JSON.stringify(v.apis))
  check('…no admin manifest (Add to home screen opens this page)', (await v.p.locator('link[rel="manifest"]').count()) === 0)

  // what the JSON holds: names, state and uptime; no container names that were renamed, no ids, images, ports
  const json = await (await v.c.request.get(BASE + '/api/public/status?tz=-60')).text()
  const body = JSON.parse(json)
  check('JSON: only title, notice, kind, overall, groups, time', JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['groups', 'notice', 'noticeKind', 'overall', 'title', 'updatedAt']))
  const leaks = ['qbittorrent', 'gluetun', 'default|', 'demo-', 'linuxserver', 'qmcgaw', '8090', 'example.com/', 'https://', 'image', 'host', 'port']
  check('JSON: no internal names, ids, images, ports or URLs', leaks.every((s) => !json.includes(s)), leaks.filter((s) => json.includes(s)).join(', '))
  const item = body.groups[0].items[0]
  check('JSON: an item is name, state, uptime and days only', JSON.stringify(Object.keys(item).sort()) === JSON.stringify(['days', 'name', 'state', 'uptime']) && item.days.length === 30)

  // the day bars: keyboard and screen readers get every day, not only a hover
  const slider = v.p.locator('[role="slider"]').first()
  await slider.focus()
  await v.p.keyboard.press('End')
  check('slider: End is today, read out as text', /^Today, \w{3} \d{1,2} \w{3}: (\d+(\.\d+)?% up|no data)$/.test(await slider.getAttribute('aria-valuetext')), await slider.getAttribute('aria-valuetext'))
  await v.p.keyboard.press('Home')
  check('slider: Home is 30 days ago', (await slider.getAttribute('aria-valuenow')) === '1' && !(await slider.getAttribute('aria-valuetext')).startsWith('Today'))
  await v.p.keyboard.press('PageUp')
  check('slider: Page Up steps a week', (await slider.getAttribute('aria-valuenow')) === '8')
  const article = v.p.locator('main article').first()
  check('slider: the focused day is written under the bars too', (await article.innerText()).includes(await slider.getAttribute('aria-valuetext')))
  // the outage jellyfin had six days ago is a marked day with a figure
  const bars = slider.locator('span')
  let warn = -1
  for (let i = 0; i < 30; i++) if (/amber|red/.test(await bars.nth(i).getAttribute('class'))) { warn = i; break }
  check('a day with downtime is marked', warn >= 0)
  if (warn >= 0) {
    await bars.nth(warn).hover(); await v.p.waitForTimeout(150)
    check('…hover names the day and its figure', /\w{3} \d{1,2} \w{3}: 9\d(\.\d+)?% up/.test(await article.innerText()))
  }
  check('visitor page: no browser errors (hydration included)', v.errs.length === 0, v.errs.join(' | '))

  // auto-refresh every 60 s, in place
  const before = await v.p.locator('main').boundingBox()
  const refreshed = v.p.waitForRequest((r) => r.url().includes('/api/public/status'), { timeout: 10_000 })
  await v.p.clock.runFor(61_000)
  const req = await refreshed.catch(() => null)
  check('refreshes with the visitor\'s time zone', !!req && /tz=-?\d+/.test(req.url()), req?.url())
  await v.p.waitForTimeout(800)
  const after = await v.p.locator('main').boundingBox()
  check('…without moving the layout', Math.abs(before.height - after.height) < 2, `${before.height} -> ${after.height}`)
  await v.c.close()

  // phone width, light and dark from the OS (visitors have no stored theme)
  for (const scheme of ['light', 'dark']) {
    const m = await visitor({ viewport: { width: 390, height: 844 }, colorScheme: scheme, isMobile: true, hasTouch: true })
    await m.p.goto(BASE + '/status', { waitUntil: 'load' }); await m.p.waitForTimeout(800)
    const dark = await m.p.evaluate(() => document.documentElement.classList.contains('dark'))
    check(`phone ${scheme}: follows the OS theme`, dark === (scheme === 'dark'))
    const overflow = await m.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(`phone ${scheme}: no sideways scrolling`, overflow <= 0, `${overflow}px`)
    await m.p.locator('[role="slider"]').nth(1).locator('span').nth(10).tap(); await m.p.waitForTimeout(150)
    check(`phone ${scheme}: tapping a day shows its figure`, /\w{3} \d{1,2} \w{3}: /.test(await m.p.locator('main article').nth(1).innerText()))
    await m.c.close()
  }

  // a POST is never let through without a session, even while the page is on
  const post = await (await browser.newContext()).request.post(BASE + '/api/public/status', { data: {} })
  check('POST to the public path still needs a login', post.status() === 401, String(post.status()))

  // ---- settings (logged in) ----
  await page.goto(BASE + '/settings?tab=monitoring', { waitUntil: 'load' }); await wait(2500)
  const sec = page.locator('section#status-page')
  check('settings: the section is under Monitoring & alerts', await sec.isVisible())
  check('…shows the link with a copy button', (await sec.innerText()).includes('/status') && (await sec.getByRole('button', { name: 'Copy status page link' }).count()) === 1)
  check('…and a preview link', (await sec.getByTestId('status-preview').getAttribute('href')) === '/status?preview')
  check('…the demo page is on', await sec.getByRole('checkbox', { name: /Publish the status page/ }).isChecked())

  // add sonarr to the first group under a name of our own, with a notice carrying markup
  const g0 = sec.getByTestId('status-group-0')
  await g0.getByRole('button', { name: 'Add apps and domains' }).click()
  await g0.getByRole('textbox', { name: 'Search apps and domains' }).fill('sonarr')
  check('picker: search narrows to sonarr', (await g0.getByRole('button', { name: /^Add / }).count()) >= 1)
  await g0.getByRole('button', { name: 'Add sonarr', exact: true }).click()
  await g0.getByRole('textbox', { name: 'Name shown for sonarr' }).fill('TV requests')
  check('picker: an added app leaves the list', (await g0.getByRole('button', { name: 'Add sonarr', exact: true }).count()) === 0)
  await sec.getByRole('textbox', { name: /Notice/ }).fill('Back soon <img src=x onerror="window.__pwned=1"> & more')
  await sec.getByRole('button', { name: 'Problem' }).click()
  check('notice kind is a pressed toggle', (await sec.getByRole('button', { name: 'Problem' }).getAttribute('aria-pressed')) === 'true')
  let saved = settingsSaved()
  await page.getByRole('button', { name: 'Save changes' }).click(); await saved; await wait(600)

  const v2 = await visitor()
  await v2.p.goto(BASE + '/status', { waitUntil: 'load' }); await v2.p.waitForTimeout(1000)
  const m2 = await v2.p.locator('main').innerText()
  check('saved changes show at once (the cache follows the settings)', m2.includes('TV requests'))
  check('…sonarr\'s own name stays private', !(await (await v2.c.request.get(BASE + '/api/public/status')).text()).includes('sonarr'))
  check('notice markup is shown as text, never run', m2.includes('<img src=x onerror="window.__pwned=1">') && (await v2.p.locator('main img').count()) === 0 && !(await v2.p.evaluate(() => window.__pwned)))
  await v2.c.close()

  // ---- off: indistinguishable from a page that never existed ----
  await page.goto(BASE + '/settings?tab=monitoring', { waitUntil: 'load' }); await wait(2500)
  await sec.getByRole('checkbox', { name: /Publish the status page/ }).uncheck()
  saved = settingsSaved()
  await page.getByRole('button', { name: 'Save changes' }).click(); await saved; await wait(600)
  check('settings: the badge says Off', (await sec.locator('.badge').first().innerText()) === 'Off')

  const anon = await browser.newContext()
  const get = async (c, path, accept = 'text/html') => { const r = await c.request.get(BASE + path, { headers: { accept }, maxRedirects: 0 }); return { status: r.status(), body: await r.text() } }
  for (const accept of ['text/html', 'application/json']) {
    const a = await get(anon, '/status', accept)
    const b = await get(anon, '/statux', accept)
    check(`off: /status is a 404 identical to a missing page (${accept})`, a.status === 404 && a.body === b.body.replaceAll('statux', 'status'))
  }
  const api = await get(anon, '/api/public/status', 'application/json')
  const apiMissing = await get(anon, '/api/public/statux', 'application/json')
  check('off: the API answers anonymous callers like a path that never existed', api.status === apiMissing.status && api.body === apiMissing.body.replaceAll('statux', 'status'), `${api.status} vs ${apiMissing.status}`)
  const apiAuthed = await get(ctx, '/api/public/status', 'application/json')
  const apiAuthedMissing = await get(ctx, '/api/public/statux', 'application/json')
  check('off: …and signed-in callers too', apiAuthed.status === 404 && apiAuthed.body === apiAuthedMissing.body.replaceAll('statux', 'status'), String(apiAuthed.status))
  check('off: a preview without a session is the same 404', (await get(anon, '/status?preview')).status === 404)
  await anon.close()

  // the admin's preview works while off, and says so
  await page.goto(BASE + '/status?preview', { waitUntil: 'load' }); await wait(1200)
  const pv = await page.locator('body').innerText()
  check('preview while off: the page with a note that it is off', pv.includes('The public page is off') && pv.includes('TV requests'))
  check('preview: links back to the settings', (await page.getByRole('link', { name: 'Status page settings' }).getAttribute('href')).startsWith('/settings'))

  // ---- the state and the figures never contradict each other ----
  await page.request.post(BASE + '/api/settings', { data: { statusPageEnabled: true, statusPage: { title: 'Band', notice: '', noticeKind: 'info', groups: [{ name: '', items: [
    { kind: 'domain', ref: 'analytics.example.com', name: 'Analytics' }, // its demo check answers 502 right now
    { kind: 'container', ref: 'default|old-wiki', name: 'Old wiki' }, // not in the fleet (removed, renamed)
  ] }] } } })
  const v3 = await visitor()
  await v3.p.goto(BASE + '/status', { waitUntil: 'load' }); await v3.p.waitForTimeout(1000)
  const [down, gone] = [v3.p.locator('main article').nth(0), v3.p.locator('main article').nth(1)]
  const lastBar = async (a) => (await a.getByTestId('day-bars').locator('span').last().getAttribute('class')) ?? ''
  const dText = await down.innerText()
  check('a domain that is down now: Down, and not 100% over 24 hours', dText.includes('Down') && !/24 hours\s*100%/.test(dText), dText.replace(/\n/g, ' | ').slice(0, 160))
  check('…and today\'s bar is not green', !(await lastBar(down)).includes('bg-ok'), await lastBar(down))
  const gText = await gone.innerText()
  check('an app homeport can\'t see: Unknown, "No data", no clean days', gText.includes('Unknown') && gText.includes('No data') && !gText.includes('100%') && !(await lastBar(gone)).includes('bg-ok'), gText.replace(/\n/g, ' | ').slice(0, 160))
  check('…and the headline does not claim all is well', (await v3.p.locator('main').innerText()).includes('Some systems are having problems'))
  await v3.c.close()
} catch (e) {
  check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | '))
}
await done()
