// Long-range history, uptime and the Prometheus endpoint in demo mode: 7d/30d on
// the dashboard and the service page (served from the 15 min and 1 h tiers),
// the uptime card, and /api/metrics behind a read token (and refused without one).
import { request as pwRequest } from 'playwright'
import { boot } from './harness.mjs'

const { BASE, page, check, done } = await boot({ port: 3312 })
const wait = (ms) => page.waitForTimeout(ms)
const historyResponse = (range) => page.waitForResponse((r) => r.url().includes('/api/history') && r.url().includes(`range=${range}`))
try {
  // ---- service page ----
  await page.goto(BASE + '/services/demo-0', { waitUntil: 'load' }); await wait(2500)
  const usage = page.locator('.card').filter({ has: page.locator('.card-title', { hasText: 'Usage' }) })
  for (const r of ['7d', '30d']) check(`service page has a ${r} range button`, (await usage.getByRole('button', { name: r, exact: true }).count()) === 1)

  const month = historyResponse('30d')
  await usage.getByRole('button', { name: '30d', exact: true }).click()
  const monthBody = await (await month).json()
  check('30d is served from the hourly tier', monthBody.res === 3600 && monthBody.t.length >= 700, `res ${monthBody.res}, ${monthBody.t.length} points`)
  await wait(400)
  check('30d button is pressed', (await usage.getByRole('button', { name: '30d', exact: true }).getAttribute('aria-pressed')) === 'true')
  const axis = await usage.locator('[aria-hidden="true"].relative').innerText().catch(() => '')
  check('30d graph has a date axis', /\d/.test(axis) && axis.split('\n').filter(Boolean).length >= 2, JSON.stringify(axis))
  // hover the graph: a month point is named by its date and called an average
  const svg = usage.locator('svg').first()
  const box = await svg.boundingBox()
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2); await wait(200)
  check('30d tooltip names the hour and says it is an average', (await usage.innerText()).includes('1 h average'))

  const week = historyResponse('7d')
  await usage.getByRole('button', { name: '7d', exact: true }).click()
  const weekBody = await (await week).json()
  check('7d is served from the 15 min tier', weekBody.res === 900 && weekBody.t.length >= 600, `res ${weekBody.res}, ${weekBody.t.length} points`)

  // ---- uptime card ----
  const uptime = page.getByTestId('uptime-card')
  check('uptime card is on the overview', await uptime.isVisible())
  const text = await uptime.innerText()
  check('…with 24 h, 7 d and 30 d figures', ['24 hours', '7 days', '30 days'].every((w) => text.includes(w)) && /\d+(\.\d+)?%/.test(text), text.slice(0, 120).replace(/\n/g, ' | '))
  check('…jellyfin\'s update outage shows as 99.9% over 30 days', text.includes('99.9%'))
  const slider = uptime.locator('[role="slider"]')
  check('…one bar per day for 30 days', (await slider.locator('> span').count()) === 30)
  check('…the day strip has a text summary', /Last 30 days: \d+ fully up, \d+ with downtime/.test(await uptime.innerText()))
  // keyboard and screen readers get every day too, not only a hover
  await slider.focus()
  await page.keyboard.press('End')
  check('…End is today, read out as text', /^Today, .+: (\d+(\.\d+)?% up|no data)/.test(await slider.getAttribute('aria-valuetext') ?? ''), await slider.getAttribute('aria-valuetext'))
  await page.keyboard.press('Home')
  check('…Home is 30 days ago', (await slider.getAttribute('aria-valuenow')) === '1')
  await page.keyboard.press('ArrowRight')
  check('…the arrow keys step a day, and the day is written under the bars', (await slider.getAttribute('aria-valuenow')) === '2' && (await uptime.innerText()).includes(await slider.getAttribute('aria-valuetext')))
  await slider.blur()
  // the day it went down is told apart from the clean days
  const bars = slider.locator('> span')
  let warnDay = -1
  for (let i = 0; i < 30; i++) if ((await bars.nth(i).getAttribute('class')).includes('amber')) { warnDay = i; break }
  check('…a day with downtime is marked', warnDay >= 0)
  if (warnDay >= 0) {
    await bars.nth(warnDay).hover(); await wait(150)
    check('…hovering it gives that day\'s figure and downtime', /: 9\d(\.\d+)?% up, about \d+ min down/.test(await uptime.innerText()))
  }

  // a stopped container still has its uptime (and no usage graph)
  await page.goto(BASE + '/services/demo-12', { waitUntil: 'load' }); await wait(2500)
  check('stopped one-shot job: uptime card, low figure', (await page.getByTestId('uptime-card').innerText()).includes('days'))

  // ---- dashboard ----
  await page.goto(BASE + '/', { waitUntil: 'load' }); await wait(2000)
  const dashWeek = historyResponse('7d')
  await page.getByRole('button', { name: '7d', exact: true }).click()
  check('dashboard 7d loads the 15 min tier', (await (await dashWeek).json()).res === 900)
  check('dashboard has a 30d button', (await page.getByRole('button', { name: '30d', exact: true }).count()) === 1)

  // ---- API ----
  const api = page.request
  const up = await (await api.get(`${BASE}/api/uptime?id=demo-0&tz=-60`)).json()
  check('/api/uptime: windows and 30 days', up.key === 'default|jellyfin' && up.windows['30d'].ratio > 0.99 && up.days.length === 30)
  const all = await (await api.get(`${BASE}/api/uptime`)).json()
  check('/api/uptime lists every container by stable key', all.services.length >= 10 && all.services.every((s) => s.key.includes('|')))
  const byKey = await (await api.get(`${BASE}/api/history?id=${encodeURIComponent('default|jellyfin')}&range=24h`)).json()
  check('/api/history accepts a container key', byKey.res === 60 && byKey.cpu.some((v) => v != null))

  // ---- /api/metrics: read token yes, nothing no ----
  const minted = await (await api.post(`${BASE}/api/tokens`, { data: { name: 'prometheus', scope: 'read' } })).json()
  const anon = await pwRequest.newContext()
  const withToken = await anon.get(`${BASE}/api/metrics`, { headers: { authorization: `Bearer ${minted.token}` } })
  const body = await withToken.text()
  check('/api/metrics answers a read-scope token', withToken.status() === 200, String(withToken.status()))
  check('…in the Prometheus text format', (withToken.headers()['content-type'] ?? '').startsWith('text/plain; version=0.0.4'))
  check('…with HELP/TYPE lines and the build info', body.includes('# TYPE homeport_container_up gauge') && /homeport_build_info\{version="[\d.]+"\} 1/.test(body))
  check('…per-container uptime by window', /homeport_container_uptime_ratio\{name="jellyfin",host="default",project="media",window="30d"\} 0\.99/.test(body))
  check('…and domain probes', body.includes('homeport_domain_probe_success{domain="'))
  const noAuth = await anon.get(`${BASE}/api/metrics`)
  check('/api/metrics refuses a request without auth', noAuth.status() === 401, String(noAuth.status()))
  const badToken = await anon.get(`${BASE}/api/metrics`, { headers: { authorization: 'Bearer hp_not-a-real-token' } })
  check('/api/metrics refuses a wrong token', badToken.status() === 401, String(badToken.status()))
  await anon.dispose()
} catch (e) {
  check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | '))
}
await done()
