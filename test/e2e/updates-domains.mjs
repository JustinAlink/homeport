import { boot } from './harness.mjs'
const { BASE, page, check, done } = await boot({ port: 3210 })
const wait = (ms) => page.waitForTimeout(ms)
const main = () => page.locator('main').innerText()
try {
  // --- updates page: what kind of update, and newer versions ---
  await page.goto(BASE + '/updates', { waitUntil: 'load' }); await wait(3000)
  let t = await main()
  check('updates: a pinned rebuild says so in plain words', /vaultwarden[\s\S]*Same version \(1\.32\.0\), rebuilt/.test(t))
  check('updates: subtitle counts newer versions', /newer versions? out/.test(t))
  const newer = page.locator('section').filter({ hasText: 'Newer versions' })
  check('newer versions: jellyfin 10.9.6 → 10.10.3 (minor)', /jellyfin[\s\S]*10\.9\.6[\s\S]*10\.10\.3[\s\S]*minor/.test(await newer.innerText()))
  check('newer versions: postgres line flagged major', /umami-db[\s\S]*18-alpine[\s\S]*major/.test(await newer.innerText()))
  check('newer versions: floating tags are not listed', !/speedtest/.test(await newer.innerText()))
  // a git-backed stack (media) gets no switch: the next update from git would reset it
  const sonarrRow = newer.locator('.row-list > div').filter({ hasText: 'sonarr' })
  check('git stack: no switch button, a "change it in git" hint instead', (await sonarrRow.getByRole('button', { name: /Switch to/ }).count()) === 0 && /change it in git/.test(await sonarrRow.innerText()))
  const refused = await page.request.post(BASE + '/api/stacks/media/service-settings', { data: { service: 'sonarr', tag: '4.0.11' } })
  check('git stack: the server refuses compose edits too (409)', refused.status() === 409, String(refused.status()))
  // switch portainer (managed, not git) to 2.21.4
  const pRow = newer.locator('.row-list > div').filter({ hasText: 'portainer' })
  await pRow.getByRole('button', { name: 'Switch to 2.21.4' }).click(); await wait(300)
  const dlg = page.getByRole('alertdialog')
  check('switch asks first, and says the compose file is changed', /compose file/.test(await dlg.innerText()))
  check('a patch switch shows no major warning', !/major version can/.test(await dlg.innerText()))
  await dlg.getByRole('button', { name: 'Switch to 2.21.4' }).click(); await wait(4500)
  const stack = await (await page.request.get(BASE + '/api/stacks/infra')).json()
  check('switch wrote the new tag into the compose file', /image: portainer\/portainer-ce:2\.21\.4/.test(stack.content), (stack.content.match(/portainer-ce:\S+/) || [''])[0])
  const svcs = await (await page.request.get(BASE + '/api/services')).json()
  check('portainer now runs 2.21.4', svcs.services.some((s) => s.name === 'portainer' && s.image.endsWith(':2.21.4')))
  check('portainer left the newer-versions list', !/portainer/.test(await newer.innerText()))
  // a major switch warns
  await newer.locator('.row-list > div').filter({ hasText: 'ghost' }).getByRole('button', { name: /Switch to 6-alpine/ }).click(); await wait(300)
  check('a major switch warns about settings and data', /major version can/.test(await page.getByRole('alertdialog').innerText()))
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click(); await wait(200)

  // git stack: the container page offers no "save to compose file" for restart/limits
  await page.goto(BASE + '/services/demo-1', { waitUntil: 'load' }); await wait(3000)
  check('git stack container: the hint points at the repository', (await page.getByText(/deployed from git/).count()) >= 1)
  await page.locator('.card', { hasText: 'Start on boot' }).locator('select').selectOption('always'); await wait(300)
  check('git stack container: no "also save to the compose file" option', !(await page.getByText(/Also save (it|them) to/).count()))
  await page.goto(BASE + '/services/demo-7', { waitUntil: 'load' }); await wait(3000)
  await page.locator('.card', { hasText: 'Start on boot' }).locator('select').selectOption('always'); await wait(300)
  check('non-git stack container: the option is offered (control)', (await page.getByText(/Also save it to/).count()) === 1)

  // --- container page update tab ---
  await page.goto(BASE + '/services/demo-8?tab=update', { waitUntil: 'load' }); await wait(3000)
  t = await main()
  check('update tab: explanation instead of raw digests', /Same version \(1\.32\.0\), rebuilt/.test(t) && !(await page.getByText(/^sha256:/).first().isVisible().catch(() => false)))
  check('update tab: newer version card with a switch', /Newer version[\s\S]*1\.32\.5/.test(t) && (await page.getByRole('button', { name: 'Switch to 1.32.5' }).count()) === 1)
  await page.goto(BASE + '/services/demo-14?tab=update', { waitUntil: 'load' }); await wait(2500)
  t = await main()
  check('update tab: latest has no newer-version card', !/Newer version/.test(t))

  // --- domains page health ---
  await page.goto(BASE + '/domains', { waitUntil: 'load' }); await wait(3500)
  t = await main()
  check('domains: jellyfin shows its HTTP status', /jellyfin\.example\.com\s*HTTP 502/.test(t))
  check('domains: portainer shows no answer', /portainer\.example\.com\s*no answer/.test(t))
  check('domains: each route links its container', (await page.locator('main a[href*="/services/"]').count()) >= 7)
  check("domains: umami shows the proxy reach warning", /can't reach[\s\S]*umami/.test(t))

  // --- dashboard attention ---
  await page.goto(BASE + '/', { waitUntil: 'load' }); await wait(4000)
  t = await main()
  check('attention: a running app whose domain answers 502', /jellyfin\s*jellyfin\.example\.com answers 502/.test(t))
  check("attention: a domain that doesn't answer", /portainer\s*portainer\.example\.com doesn't answer/.test(t))
  await page.locator('main').getByRole('button', { name: /^Issues/ }).click(); await wait(800)
  t = await main()
  check('issues filter lists what the strip counts (umami, jellyfin)', /umami/.test(t) && /jellyfin/.test(t) && !/vaultwarden/.test(t))

  // --- stack page: git stack still offers the image update ---
  await page.goto(BASE + '/stacks/media', { waitUntil: 'load' }); await wait(3000)
  check('git stack: "Update images (1)" is offered', (await page.getByRole('button', { name: /Update images \(1\)/ }).count()) === 1)
  check('…and the duplicate Pull & up is hidden', (await page.getByRole('button', { name: /^Pull & up$/ }).count()) === 0)

  // --- activity shares the page edge ---
  await page.goto(BASE + '/', { waitUntil: 'load' }); await wait(1500)
  const x1 = (await page.locator('main h1').first().boundingBox()).x
  await page.goto(BASE + '/activity', { waitUntil: 'load' }); await wait(1500)
  const x2 = (await page.locator('main h1').first().boundingBox()).x
  check('activity heading lines up with the dashboard', Math.abs(x1 - x2) < 1, `${x1} vs ${x2}`)

  // --- mobile tabs ---
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(BASE + '/services/demo-0', { waitUntil: 'load' }); await wait(2500)
  const edge = page.locator('main [role=tablist] + button, main [role=tablist] ~ button').last()
  check('mobile: the tab strip shows a "more" edge', await edge.isVisible())
  check('mobile: the off-screen Update tab still shows its dot on the edge', (await edge.locator('.dot').count()) === 1)
  await page.goto(BASE + '/services/demo-0?tab=update', { waitUntil: 'load' }); await wait(2500)
  const upd = page.getByRole('tab', { name: /Update/ })
  const bb = await upd.boundingBox()
  check('mobile: opening a far tab scrolls it into view', bb && bb.x >= 0 && bb.x + bb.width <= 390, JSON.stringify(bb))
} catch (e) { check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | ')) }
await done()
