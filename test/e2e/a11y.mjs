// Accessibility gate: axe-core (WCAG 2 A/AA) on every main page, dark and light.
// One known exception: the syntax colours of CodeMirror's One Dark theme (a
// third-party theme; its red for YAML keys sits around 4.1 to 4.4:1). Anything
// else fails the run.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { boot } from './harness.mjs'

const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const PAGES = [
  '/', '/stacks', '/stacks/media', '/networks', '/storage', '/updates', '/catalog', '/catalog/uptime-kuma', '/activity', '/domains',
  '/settings', '/settings?tab=proxy', '/settings?tab=capabilities', '/settings?tab=monitoring', '/settings?tab=updates',
  '/settings?tab=security', '/settings?tab=system', '/services/demo-0', '/services/demo-2?tab=env', '/services/demo-5?tab=update',
  '/services/demo-8?tab=update', '/welcome',
]
// CodeMirror token spans (`.cm-line > .ͼq`, generated class names) inside the editor
const allowed = (target) => /\.cm-|ͼ/.test(target)

const found = []
for (const scheme of ['dark', 'light']) {
  const { BASE, page, done, check } = await boot({ port: scheme === 'dark' ? 3180 : 3181 })
  await page.emulateMedia({ colorScheme: scheme })
  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: 'load' })
    await page.waitForTimeout(2500)
    await page.addScriptTag({ content: axe })
    const violations = await page.evaluate(async () =>
      (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => ({
        id: v.id,
        help: v.help,
        nodes: v.nodes.map((x) => ({ target: x.target.join(' '), why: (x.failureSummary || '').split('\n')[1] || '' })),
      })),
    )
    const bad = violations.flatMap((v) => v.nodes.filter((n) => !allowed(n.target)).map((n) => `${v.id}: ${n.target} :: ${n.why}`))
    check(`${scheme} ${p}: no WCAG A/AA violations`, bad.length === 0, bad.slice(0, 3).join(' | '))
    found.push(...bad.map((b) => `${scheme} ${p} ${b}`))
  }
  await done()
}
if (found.length) console.log(`\n${found.length} violation(s):\n` + found.slice(0, 30).join('\n'))
