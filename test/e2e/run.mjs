// Runs every browser suite against the production build (`npm run build` first),
// one after another, and fails if any suite reports a FAIL, crashes, or sees an
// unexpected browser error. `npm run e2e -- pins networks` runs a subset.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SUITES = ['regression', 'access', 'stacks', 'networks', 'updates-domains', 'git-editor', 'managed-stacks', 'pins', 'settings-locks', 'a11y']
const pick = process.argv.slice(2)
const run = pick.length ? SUITES.filter((s) => pick.includes(s)) : SUITES
const failed = []
for (const s of run) {
  const t0 = Date.now()
  console.log(`\n=== ${s}`)
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(`./${s}.mjs`, import.meta.url))], { stdio: 'inherit' })
  console.log(`=== ${s}: ${r.status === 0 ? 'ok' : 'FAILED'} (${Math.round((Date.now() - t0) / 1000)}s)`)
  if (r.status !== 0) failed.push(s)
}
console.log(failed.length ? `\ne2e: ${failed.length} suite(s) failed: ${failed.join(', ')}` : `\ne2e: all ${run.length} suites passed`)
process.exitCode = failed.length ? 1 : 0
