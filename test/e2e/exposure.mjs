// The exposure report in demo mode: levels, findings with their fix, the sidebar
// badge, and Accept / Undo (which must stop a finding counting without hiding it).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot } from './harness.mjs'

const { BASE, page, check, done, dataDir } = await boot({ port: 3217 })
const wait = (ms) => page.waitForTimeout(ms)
const badge = async () => (await page.locator('aside nav a[href="/exposure"]').innerText()).replace(/\D+/g, '') || '0'
const card = (name) => page.locator('article').filter({ has: page.getByRole('link', { name, exact: true }) })
try {
  await page.goto(BASE + '/exposure', { waitUntil: 'load' }); await wait(2500)
  check('page title', (await page.title()).startsWith('Exposure'))
  check('needs-attention tile counts 2', (await page.getByRole('button', { name: /Needs attention/ }).innerText()).includes('2'))
  check('sidebar badge shows 2', (await badge()) === '2', await badge())
  const qbit = card('qbittorrent')
  check('qbittorrent: reachable around the proxy', (await qbit.innerText()).includes('Reachable around the proxy'))
  check('…its probe shows the login', (await qbit.innerText()).includes('asks for a login'))
  check('…the fix shows the exact compose line', (await qbit.innerText()).includes('"127.0.0.1:8090:8090"'))
  check('sonarr shows its sign-in portal', (await card('sonarr').innerText()).includes('sign-in at auth.example.com'))
  check('the proxy itself: only its admin port is flagged', (await card('traefik').innerText()).includes('admin port is open'))
  check('quiet group starts folded', (await page.getByRole('button', { name: /^Show \d+$/ }).count()) === 1)

  // filter through the summary tile, kept in the URL
  await page.getByRole('button', { name: /Worth a look/ }).click(); await wait(400)
  check('tile filters and lands in ?level=', page.url().includes('level=warn') && (await page.locator('section h2').count()) === 1)
  await page.getByRole('button', { name: /Worth a look/ }).click(); await wait(400)

  // accept qbittorrent's finding with a reason
  await qbit.getByRole('button', { name: 'Accept…' }).click()
  const note = qbit.getByRole('textbox', { name: 'Why is this fine?' })
  check('accept asks for a reason (Accept disabled while empty)', await qbit.getByRole('button', { name: 'Accept', exact: true }).isDisabled())
  await note.fill('LAN clients use the port directly')
  await qbit.getByRole('button', { name: 'Accept', exact: true }).click(); await wait(1500)
  check('badge drops to 1', (await badge()) === '1', await badge())
  const moved = card('qbittorrent')
  check('qbittorrent now reads "through the proxy"', (await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Through the proxy' }) }).innerText()).includes('qbittorrent'))
  check('…with its accepted finding still listed', (await moved.innerText()).includes('1 accepted'))
  const stored = JSON.parse(readFileSync(join(dataDir, 'exposure.json'), 'utf8'))
  check('stored by container name and rule, with the reason', stored.acks['default|qbittorrent|around-proxy']?.note === 'LAN clients use the port directly', JSON.stringify(stored))

  // undo brings it back
  await moved.locator('summary').click(); await wait(200)
  await moved.getByRole('button', { name: 'Undo' }).click(); await wait(1500)
  check('undo restores the badge', (await badge()) === '2', await badge())

  // the service page shows the same findings
  await page.goto(BASE + '/services/demo-7', { waitUntil: 'load' }); await wait(3000)
  const main = await page.locator('main').innerText()
  check('service page: level on the Access card and an Exposure card', main.includes('Needs attention') && main.includes('Controls Docker and is reachable'))
} catch (e) {
  check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | '))
}
await done()
