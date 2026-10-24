import { boot } from './harness.mjs'
const { BASE, page, check, done } = await boot({ port: 3215 })
const wait = (ms) => page.waitForTimeout(ms)
const D2 = 'sha256:' + '2e'.repeat(32), D4 = 'sha256:' + '4c'.repeat(32)
try {
  await page.goto(BASE + '/updates', { waitUntil: 'load' }); await wait(3500)
  const newer = page.locator('section').filter({ hasText: 'Newer versions' })
  const q = newer.locator('.row-list > div').filter({ hasText: 'qbittorrent' })
  check('rebuilt pin listed with a "rebuilt" badge', /5\.0\.0[\s\S]*rebuilt/.test(await q.innerText()))
  check('rebuilt pin: Copy pin holds the new digest', ((await q.getByRole('button', { name: /Copy pin/ }).getAttribute('title')) || '').includes(`qbittorrent:5.0.0@${D2}`))
  const hint = q.getByRole('link', { name: /change it in ansible playbook/ })
  check('managed stack: the owner hint links to its url', (await hint.getAttribute('href')) === 'https://github.com/example/infra')
  const r = newer.locator('.row-list > div').filter({ hasText: 'restic' })
  check('pinned newer version listed (1.6.0 → 1.7.0)', /1\.6\.0[\s\S]*1\.7\.0[\s\S]*minor/.test(await r.innerText()))
  check('pinned newer version: Copy pin is tag + digest', ((await r.getByRole('button', { name: /Copy pin/ }).getAttribute('title')) || '').includes(`mazzolino/restic:1.7.0@${D4}`))
  await r.getByRole('button', { name: 'Switch to 1.7.0' }).click(); await wait(300)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Switch to 1.7.0' }).click(); await wait(4500)
  const st = await (await page.request.get(BASE + '/api/stacks/backups')).json()
  check('switching a digest pin writes the new tag AND digest', st.content.includes(`image: mazzolino/restic:1.7.0@${D4}`), (st.content.match(/restic:\S+/) || [''])[0])
  // a major jump AND a rebuild of the current version: the rebuild is the first (safe) pin
  await page.goto(BASE + '/updates', { waitUntil: 'load' }); await wait(3500)
  const w = page.locator('section').filter({ hasText: 'Newer versions' }).locator('.row-list > div').filter({ hasText: 'watchtower' })
  const wt = await w.innerText()
  check('major + rebuilt: both badges shown', /2\.0\.0[\s\S]*major[\s\S]*rebuilt/.test(wt))
  check('major + rebuilt: Copy pin is the rebuilt current version first', ((await w.getByRole('button', { name: /Copy pin/ }).getAttribute('title')) || '').includes('watchtower:1.7.1@sha256:' + '79'.repeat(32)))
  // stack page badge is a link
  await page.goto(BASE + '/stacks/downloads', { waitUntil: 'load' }); await wait(3000)
  check('stack badge links to the owner', (await page.locator('main a.badge', { hasText: 'managed by ansible playbook' }).getAttribute('href')) === 'https://github.com/example/infra')
  // container page: rebuilt card with the exact pin
  await page.goto(BASE + '/services/demo-9?tab=update', { waitUntil: 'load' }); await wait(3000)
  const t = await page.locator('main').innerText()
  check('update tab: "Rebuilt image" card with the new pin', /Rebuilt image[\s\S]*was rebuilt since you pinned it/.test(t) && t.includes(`qbittorrent:5.0.0@${D2}`))
} catch (e) { check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | ')) }
await done()
