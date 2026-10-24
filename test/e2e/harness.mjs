// Boots the production build in demo mode (like test/smoke.mjs) and returns a logged-in page.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// Browser checks against the production build in demo mode: each suite boots its
// own server (fresh demo state) on its own port. `check()` records PASS/FAIL;
// `done()` prints them and sets a failing exit code on any FAIL or unexpected
// browser error, so `npm run e2e` (test/e2e/run.mjs) can gate CI on them.
export const ROOT = fileURLToPath(new URL('../..', import.meta.url))
export async function boot({ port = 3128, env = {}, viewport = { width: 1440, height: 900 }, password = 'pw-test', login = true, hasTouch = false, allowErrors = [] } = {}) {
  const BASE = `http://127.0.0.1:${port}`
  // refuse to test against a stale server left by a crashed run
  try { await fetch(`${BASE}/login`); throw new Error(`port ${port} is already serving: stale test server?`) } catch (e) { if (String(e.message).includes('stale')) throw e }
  const dataDir = mkdtempSync(join(tmpdir(), 'hp-int-'))
  const server = spawn('node', ['.output/server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOMEPORT_DEMO: 'true', HOMEPORT_ADMIN_PASSWORD: password, HOMEPORT_DATA_DIR: dataDir,
      HOMEPORT_ALLOW_CONTROL: 'true', HOMEPORT_UPDATE_CHECK: 'true', HOMEPORT_ALLOW_UPDATES: 'true', HOMEPORT_ALLOW_STACKS: 'true',
      HOMEPORT_ALLOW_TERMINAL: 'true', HOMEPORT_ALLOW_PROXY_ADMIN: 'true', ...env },
    stdio: 'ignore',
  })
  process.on('exit', () => server.kill()) // never leave a server holding the port after a crash
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/login`)).ok) break } catch {} ; await new Promise((r) => setTimeout(r, 500)) }
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport, hasTouch, isMobile: hasTouch })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|ERR_ABORTED|Failed to fetch/.test(m.text())) errs.push('console: ' + m.text()) })
  if (login) await page.request.post(`${BASE}/api/auth/login`, { data: { password } })
  const results = []
  const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }
  async function done() {
    // a suite may expect some browser errors (e.g. requests it aborts on purpose)
    const unexpected = errs.filter((e) => !allowErrors.some((re) => re.test(e)))
    console.log(results.join('\n'))
    console.log(unexpected.length ? 'ERRORS:\n' + unexpected.join('\n') : 'no page/console errors')
    if (unexpected.length || results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1
    await browser.close(); server.kill(); rmSync(dataDir, { recursive: true, force: true })
  }
  return { BASE, page, ctx, check, done, errs, dataDir }
}
