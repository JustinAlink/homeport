import { getConfig } from '../utils/config'
import { authMode } from '../utils/auth'

// Which optional capabilities are enabled — the single source the UI uses to
// show/hide affordances (buttons, pages, panels). Auth-gated like all /api/*.
export default defineEventHandler(() => {
  const cfg = getConfig()
  return {
    control: cfg.allowControl,
    logs: cfg.logsEnabled,
    updateCheck: cfg.updateCheckEnabled,
    updates: cfg.allowUpdates,
    stacks: cfg.allowStacks,
    terminal: cfg.allowTerminal,
    proxyAdmin: cfg.allowProxyAdmin,
    // first-run / account hints (not secrets)
    loginDisabled: authMode() === 'open', // running without a login
    passwordEnvLocked: !!process.env.HOMEPORT_ADMIN_PASSWORD, // change-password unavailable
    demo: cfg.demo,
  }
})
