import { getConfig } from '../utils/config'
import { readSettings } from '../utils/settings'
import { exportAuthFile } from '../utils/auth'
import { listTokens } from '../utils/git-stacks'

// Download a restorable backup of homeport's persisted state: settings (hosts,
// channels, proxy creds…), the auth file (password hash + session secret) and
// per-stack git tokens. Operational caches (history, update checks, alert log)
// are rebuildable and deliberately excluded — as are the compose files in the
// stacks dir, which live outside the data dir (back those up separately / use git).
// The result contains SECRETS — it is only served to the authenticated admin.
export default defineEventHandler((event) => {
  const stamp = new Date().toISOString().slice(0, 10)
  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Content-Disposition', `attachment; filename="homeport-backup-${stamp}.json"`)
  return {
    format: 'homeport-backup',
    version: 1,
    exportedAt: Date.now(),
    demo: getConfig().demo || undefined, // flags demo exports so a restore can warn
    settings: readSettings(),
    auth: exportAuthFile(),
    gitTokens: listTokens(),
  }
})
