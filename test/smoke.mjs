// Smoke test: boot the built app in demo mode and visit every page, failing on
// any page error, console error, or 5xx response. Run with `npm run smoke`
// (needs `npm run build` first, and a Playwright Chromium:
// `npx playwright install chromium`). CI runs this on every push.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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

if (problems.length) {
  console.error(`\nSMOKE FAILED (${problems.length}):`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\nsmoke: all pages clean')
