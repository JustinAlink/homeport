// Smoke test: boot the built app in demo mode and visit every page, failing on
// any page error, console error, or 5xx response. Run with `npm run smoke`
// (needs `npm run build` first, and a Playwright Chromium:
// `npx playwright install chromium`). CI runs this on every push.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const PORT = Number(process.env.SMOKE_PORT || 3123)
const BASE = `http://127.0.0.1:${PORT}`
const dataDir = mkdtempSync(join(tmpdir(), 'hp-smoke-'))

// every capability on, so every page and affordance renders
const server = spawn('node', ['.output/server/index.mjs'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOMEPORT_DEMO: 'true',
    HOMEPORT_ADMIN_PASSWORD: 'smoke',
    HOMEPORT_DATA_DIR: dataDir,
    HOMEPORT_ALLOW_CONTROL: 'true',
    HOMEPORT_UPDATE_CHECK: 'true',
    HOMEPORT_ALLOW_UPDATES: 'true',
    HOMEPORT_ALLOW_STACKS: 'true',
    HOMEPORT_ALLOW_TERMINAL: 'true',
    HOMEPORT_ALLOW_PROXY_ADMIN: 'true',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
})

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/login`)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server did not come up')
}

// [path, marker that must appear in <main> (case-insensitive)]
const PAGES = [
  ['/', 'fleet'],
  ['/updates', 'newer image'],
  ['/activity', 'activity'],
  ['/stacks', 'compose projects homeport manages'],
  ['/stacks/media', 'compose.yaml'],
  ['/stacks/legacy-app', 'unmanaged'],
  ['/networks', 'reach each other by name'],
  ['/storage', 'volumes and images on this host'],
  ['/welcome', 'Welcome to homeport'],
  ['/catalog', 'app catalog'],
  ['/catalog/uptime-kuma', 'install'],
  ['/catalog/hub/jellyfin/jellyfin', 'install'],
  ['/domains', 'domain'],
  ['/settings', 'capabilities'],
  ['/services/demo-0', 'jellyfin'],
  ['/services/demo-13', 'legacy-app'],
]

const problems = []
let browser
try {
  await waitForServer()
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()}: ${r.url()}`)
  })

  await page.goto(`${BASE}/login`)
  await page.fill('input[type=password]', 'smoke')
  await page.click('button[type=submit]')
  await page.waitForURL(`${BASE}/`)

  // console errors only count once authenticated (the login page probes an API and gets a 401)
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // expected 4xx probes (unmanaged-stack detection etc.) surface as resource errors — ignore those
    if (/the server responded with a status of 4\d\d/.test(m.text())) return
    problems.push(`console.error: ${m.text()}`)
  })

  for (const [path, marker] of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
    // poll for the marker — pages with remote fetches (catalog sources) can be slow
    let seen = false
    for (let i = 0; i < 30 && !seen; i++) {
      await page.waitForTimeout(500)
      const text = (await page.locator('main').innerText().catch(() => '')).toLowerCase()
      seen = text.includes(marker.toLowerCase())
    }
    if (!seen) problems.push(`${path}: expected to see "${marker}"`)
    else console.log(`ok ${path}`)
  }

  // the service page's tabs are where setup-order bugs bite — click them all
  await page.goto(`${BASE}/services/demo-0`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  for (const tab of ['Logs', 'Terminal', 'Environment', 'Domains', 'Update', 'Overview']) {
    await page.click(`nav button:text-is("${tab}")`)
    await page.waitForTimeout(500)
  }
  console.log('ok /services/demo-0 tabs')
} catch (e) {
  problems.push(`fatal: ${e?.message || e}`)
} finally {
  await browser?.close()
  server.kill()
  rmSync(dataDir, { recursive: true, force: true })
}

// --- First-run setup gate ---------------------------------------------------
// A fresh install (no password yet) must not be claimable without the setup
// code from its own log, and "skip" must not turn the login off. Booted with an
// auth.json from a pre-v2.32.0 "skip" (must no longer open anything) and at log
// level error (the code must print anyway).
const SETUP_PORT = PORT + 1
const SETUP_BASE = `http://127.0.0.1:${SETUP_PORT}`
const setupDir = mkdtempSync(join(tmpdir(), 'hp-setup-'))
writeFileSync(join(setupDir, 'auth.json'), JSON.stringify({ authSkipped: true }))
let setupLog = ''
const setupServer = spawn('node', ['.output/server/index.mjs'], {
  env: {
    ...process.env,
    PORT: String(SETUP_PORT),
    HOMEPORT_DEMO: 'true',
    HOMEPORT_DATA_DIR: setupDir,
    HOMEPORT_ADMIN_PASSWORD: '',
    HOMEPORT_ALLOW_OPEN: '',
    HOMEPORT_LOG_LEVEL: 'error',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
setupServer.stdout.on('data', (d) => (setupLog += d))
setupServer.stderr.on('data', (d) => (setupLog += d))

const expect = (ok, what) => (ok ? console.log(`ok setup: ${what}`) : problems.push(`setup: ${what}`))
const setupPost = async (body) => {
  const r = await fetch(`${SETUP_BASE}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return r.status
}
const setupState = () => fetch(`${SETUP_BASE}/api/setup`).then((r) => r.json())

let setupBrowser
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${SETUP_BASE}/login`)).ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  const pw = 'setup-smoke-password'
  let st = await setupState()
  expect(st.needsSetup === true && st.open === false, 'a pre-v2.32.0 "skip" no longer opens the instance')
  expect((await fetch(`${SETUP_BASE}/api/services`)).status === 401, 'the API stays locked until setup is done')
  expect((await setupPost({ password: pw })) === 400, 'a password without the code is refused')
  expect((await setupPost({ skip: true })) === 403, '"skip" is refused')
  expect((await setupPost({ code: 'ZZZZ-ZZZZ-ZZZZ', password: pw })) === 403, 'a wrong code is refused')
  st = await setupState()
  expect(st.needsSetup === true && st.open === false, 'still in setup after all of that')

  const code = setupLog.match(/setup code: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1]
  expect(!!code, 'the code is in the log, even at HOMEPORT_LOG_LEVEL=error')
  if (!code) throw new Error('no setup code in the server log')

  // the real form: link prefill (install.sh's /login#code=…), a wrong code, then the right one
  setupBrowser = await chromium.launch()
  const page = await setupBrowser.newPage()
  page.on('pageerror', (e) => problems.push(`setup pageerror: ${e.message}`))
  await page.goto(`${SETUP_BASE}/login#code=${code}`)
  const field = page.locator('#setup-code')
  await field.waitFor()
  await page.waitForFunction(() => document.querySelector('#setup-code')?.value)
  expect((await field.inputValue()) === code && !page.url().includes('#'), 'the link fills in the code and drops it from the address bar')
  await field.fill('zzzz-zzzz-zzzz')
  await page.fill('#new-pw', pw)
  await page.fill('#confirm-pw', pw)
  await page.click('button[type=submit]')
  await page.locator('[role=alert]').waitFor()
  expect(/doesn't match/.test(await page.locator('[role=alert]').innerText()) && (await field.getAttribute('aria-invalid')) === 'true', 'the form says the code is wrong and marks the field')
  await field.fill(code.toLowerCase().replace(/-/g, ' '))
  await page.click('button[type=submit]')
  await page.waitForURL(`${SETUP_BASE}/welcome`)
  expect(true, 'the right code (typed loosely) creates the password and continues to /welcome')

  expect((await setupPost({ code, password: 'another-long-password' })) === 403, 'setup is closed once a password exists')
  expect((await setupState()).needsSetup === false, 'the login page now shows sign-in')
  expect(!('authSkipped' in JSON.parse(readFileSync(join(setupDir, 'auth.json'), 'utf8'))), 'the stale skip flag is gone from auth.json')
} catch (e) {
  problems.push(`setup fatal: ${e?.message || e}`)
} finally {
  await setupBrowser?.close()
  setupServer.kill()
  rmSync(setupDir, { recursive: true, force: true })
}

if (problems.length) {
  console.error(`\nSMOKE FAILED (${problems.length}):`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\nsmoke: all pages clean, setup gate holds')
