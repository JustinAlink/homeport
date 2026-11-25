// Domain sources in demo mode: the new provider choices and their fields on
// Settings > Proxy, the Traefik API password as a masked secret (stored, never sent
// back, dropped when the URL moves to another server), the read-only note on the
// write side, and where a domain came from on the service page and the dashboard.
// The parsers themselves are unit-tested against fixtures (test/domain-sources.test.ts):
// demo mode has no proxy to read.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot } from './harness.mjs'

const { BASE, page, check, done, dataDir } = await boot({ port: 3301 })
const wait = (ms) => page.waitForTimeout(ms)
const stored = () => { try { return JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')) } catch { return {} } }
const proxy = () => page.locator('section#proxy')
async function save() {
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  await wait(400)
}
try {
  await page.goto(BASE + '/settings?tab=proxy', { waitUntil: 'load' }); await wait(2000)
  const select = proxy().getByLabel('Provider', { exact: true })
  const options = await select.locator('option').allInnerTexts()
  check('provider choices include the three new sources', ['Traefik (API)', 'caddy-docker-proxy (labels)', 'Pangolin (labels)'].every((o) => options.includes(o)), options.join(' / '))

  await select.selectOption('traefik-api'); await wait(200)
  const url = proxy().getByLabel('Traefik API URL')
  check('Traefik API: URL, username and password fields', (await url.isVisible()) && (await proxy().getByLabel(/API username/).isVisible()) && (await proxy().getByLabel(/API password/).getAttribute('type')) === 'password')
  check('…the hint says the API belongs on an internal entrypoint', /internal entrypoint/.test(await proxy().innerText()) && /never publish/.test(await proxy().innerText()))
  check('…the write side says this source is read-only', /Traefik \(API\) is a read-only source/.test(await page.locator('section#proxy-admin').innerText()))

  await url.fill('http://traefik:8080')
  await proxy().getByLabel(/API username/).fill('admin')
  await proxy().getByLabel(/API password/).fill('s3cret-pw')
  await save()
  check('saved: the password is on disk', stored().traefikApiPassword === 's3cret-pw' && stored().domainProvider === 'traefik-api', JSON.stringify({ p: stored().domainProvider }))
  const view = await (await page.request.get(BASE + '/api/settings')).json()
  check('…and never in the settings response, only a flag', view.settings.traefikApiPassword === '' && view.settings.traefikApiPasswordSet === true && !JSON.stringify(view).includes('s3cret-pw'))
  check('…the field empties and says one is stored', (await proxy().getByLabel(/API password/).inputValue()) === '' && /A password is stored/.test(await proxy().innerText()))

  await page.reload({ waitUntil: 'load' }); await wait(1500)
  check('after a reload the choice and URL are kept', (await proxy().getByLabel('Provider', { exact: true }).inputValue()) === 'traefik-api' && (await proxy().getByLabel('Traefik API URL').inputValue()) === 'http://traefik:8080')

  // saving with the password left blank keeps it; moving the URL to another server drops it
  await proxy().getByLabel(/API username/).fill('admin2')
  await save()
  check('blank password on save keeps the stored one', stored().traefikApiPassword === 's3cret-pw' && stored().traefikApiUser === 'admin2')
  await proxy().getByLabel('Traefik API URL').fill('http://elsewhere.example.com:8080')
  await save()
  check('a different server drops the stored password', !stored().traefikApiPassword, String(stored().traefikApiPassword))

  await proxy().getByRole('button', { name: 'Test provider' }).click(); await wait(800)
  check('test provider answers', /Demo: 9 route/.test(await proxy().innerText()))

  for (const [value, text] of [['caddy-docker-proxy', /caddy_0/], ['pangolin', /pangolin\.public-resources/]]) {
    await proxy().getByLabel('Provider', { exact: true }).selectOption(value); await wait(200)
    check(`${value}: explains which labels it reads`, text.test(await proxy().innerText()))
  }
  await proxy().getByLabel('Provider', { exact: true }).selectOption('traefik-api'); await wait(100)

  // per-host fields in the multi-host list
  await page.goto(BASE + '/settings?tab=connection', { waitUntil: 'load' }); await wait(1500)
  await page.getByRole('button', { name: '+ Add host' }).click(); await wait(200)
  const hosts = page.locator('section#hosts')
  await hosts.getByLabel('Reverse proxy').last().selectOption('traefik-api'); await wait(200)
  check('a host can read its own Traefik API', (await hosts.getByLabel('Traefik API URL').count()) === 1 && (await hosts.getByLabel(/API password/).count()) === 1)
  await page.getByRole('button', { name: 'Discard' }).click(); await wait(300)

  // where each domain came from
  await page.goto(BASE + '/services/demo-8', { waitUntil: 'load' }); await wait(2500)
  check('service page: a Pangolin domain says so', (await page.locator('main').innerText()).includes('from Pangolin'))
  await page.goto(BASE + '/services/demo-0', { waitUntil: 'load' }); await wait(2500)
  check('service page: a Traefik API domain says so', (await page.locator('main').innerText()).includes('from Traefik (API)'))
  await page.goto(BASE + '/', { waitUntil: 'load' }); await wait(2500)
  const orphan = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Domains without a container' }) })
  check('dashboard: a domain without a container names its source', (await orphan.innerText()).includes('from Traefik (API)'))
} catch (e) {
  check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | '))
}
await done()
