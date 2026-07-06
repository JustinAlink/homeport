import { version } from '../../package.json'
import { getConfig } from '../utils/config'
import { authMode } from '../utils/auth'
import { settingsWritable } from '../utils/settings'
import { getHosts } from '../utils/hosts'
import { log } from '../utils/log'

// One boot banner stating the effective runtime configuration. This is the
// single highest-value log line: it answers most "why is it behaving like X?"
// questions (auth mode, is the data dir writable, where's Docker, which
// capabilities are on) without a debugging session. No secrets are logged.
export default defineNitroPlugin(() => {
  const cfg = getConfig()

  if (cfg.demo) {
    log.info('startup', `homeport ${version} starting in DEMO mode (synthetic fleet, no Docker)`)
    return
  }

  const hosts = safe(() => getHosts().map((h) => h.dockerHost || 'unix socket').join(', '), 'unknown')
  const mode = safe(authMode, 'unknown')
  const writable = safe(settingsWritable, false)
  const dataDir = process.env.HOMEPORT_DATA_DIR || '/data'

  // Capabilities that are ON — a compact list beats a long "x=false" dump.
  const caps: string[] = []
  if (cfg.allowControl) caps.push('control')
  if (cfg.logsEnabled) caps.push('logs')
  if (cfg.updateCheckEnabled) caps.push('update-check')
  if (cfg.allowUpdates) caps.push('updates')
  if (cfg.allowStacks) caps.push('stacks')
  if (cfg.allowTerminal) caps.push('terminal')
  if (cfg.allowProxyAdmin) caps.push('proxy-admin')
  if (cfg.autoUpdateEnabled) caps.push(`auto-update@${cfg.autoUpdateHour}h`)
  if (cfg.alertsEnabled) caps.push('alerts')

  log.info('startup', `homeport ${version} starting — log level ${log.level}`)
  log.info('startup', `auth: ${mode}${mode === 'open' ? ' (NO LOGIN — set HOMEPORT_ADMIN_PASSWORD or run first-run setup)' : ''}`)
  log.info('startup', `data dir: ${dataDir} (${writable ? 'writable' : 'READ-ONLY — settings/history/sessions will not persist'})`)
  log.info('startup', `docker: ${hosts}`)
  log.info('startup', `collector: every ${cfg.collectorInterval}s · history ${cfg.historyEnabled ? 'on' : 'off'}`)
  log.info('startup', `capabilities on: ${caps.length ? caps.join(', ') : 'none (read-only)'}`)

  if (mode === 'open' && writable) {
    log.warn('startup', 'running without a login — anyone who can reach this URL has full access')
  }
})

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}
