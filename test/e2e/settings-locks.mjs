// A switch set by an environment variable (here HOMEPORT_ALERTS=true) must show
// as ON on the settings page, so the options under it stay editable, and saving
// must not write the env-owned value into settings.json.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot } from './harness.mjs'

const { BASE, page, check, done, dataDir } = await boot({ port: 3216, env: { HOMEPORT_ALERTS: 'true' } })
const wait = (ms) => page.waitForTimeout(ms)
try {
  await page.goto(BASE + '/settings?tab=monitoring', { waitUntil: 'load' }); await wait(2500)
  check('locked alerts switch shows ON', await page.getByRole('checkbox', { name: /Notify on service state changes/ }).isChecked())
  const recovered = page.getByRole('checkbox', { name: 'Recovered' })
  check('env-locked on: the transitions are visible', await recovered.isVisible())
  check('…and editable', await recovered.isEnabled())
  await recovered.check(); await wait(200)
  await page.getByRole('button', { name: /^Save/ }).first().click(); await wait(1500)
  const s = await (await page.request.get(BASE + '/api/settings')).json()
  check('Recovered is saved', s.settings.alertTransitions?.recovered === true, JSON.stringify(s.settings.alertTransitions))
  const saved = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))
  check('the env-owned alertsEnabled is not written to settings.json', !('alertsEnabled' in saved), JSON.stringify(Object.keys(saved)))
} catch (e) {
  check('suite ran to the end', false, String(e.message).split('\n').slice(0, 3).join(' | '))
}
await done()
