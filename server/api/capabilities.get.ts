import { getConfig } from '../utils/config'
import { authMode, trustedAuthHeader } from '../utils/auth'
import { accessOf } from '../utils/session-access'

// Which optional capabilities are enabled — the single source the UI uses to
// show/hide affordances (buttons, pages, panels). Auth-gated like all /api/*.
export default defineEventHandler((event) => {
  const cfg = getConfig()
  const viewer = accessOf(event) === 'viewer'
  return {
    control: cfg.allowControl && !viewer,
    logs: cfg.logsEnabled,
    updateCheck: cfg.updateCheckEnabled,
    updates: cfg.allowUpdates && !viewer,
    stacks: cfg.allowStacks,
    // the public delivery endpoint only works with stacks on, so the UI asks for both
    gitWebhooks: cfg.allowGitWebhooks && cfg.allowStacks && !viewer,
    terminal: cfg.allowTerminal && !viewer,
    containerFiles: cfg.allowContainerFiles && !viewer,
    proxyAdmin: cfg.allowProxyAdmin,
    // alerts are configured: snooze and pause controls are worth showing (demo shows them)
    alerts: cfg.alertsEnabled || cfg.demo,
    // first-run / account hints (not secrets)
    loginDisabled: authMode() === 'open', // running without a login
    passwordEnvLocked: !!process.env.HOMEPORT_ADMIN_PASSWORD, // change-password unavailable
    forwardAuth: !!trustedAuthHeader(), // authenticated by an upstream proxy header
    demo: cfg.demo,
    viewer, // this session belongs to a read-only viewer account
  }
})
