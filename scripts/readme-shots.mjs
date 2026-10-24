// README screenshots from the production build in demo mode (dark theme, no devtools overlay).
import { boot, ROOT } from '../test/e2e/harness.mjs'
const { BASE, page, done, ctx } = await boot({ port: 3150 })
await ctx.addInitScript(() => localStorage.setItem('hp:theme', 'dark'))
await page.emulateMedia({ colorScheme: 'dark' })
for (const [path, name, ms] of [['/', 'screenshot', 9000], ['/services/demo-0', 'service-page', 4000], ['/stacks/media', 'stacks', 4000], ['/updates', 'updates', 4000]]) {
  await page.goto(BASE + path, { waitUntil: 'load' })
  await page.waitForTimeout(ms)
  await page.mouse.move(1430, 890)
  await page.screenshot({ path: `${ROOT}/docs/${name}.png` })
  console.log('wrote', name)
}
await done()
