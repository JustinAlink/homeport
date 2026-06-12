import { getConfig } from '../utils/config'

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
    // first-run hints (not secrets — just whether onboarding steps remain)
    loginDisabled: !cfg.adminPassword,
    demo: cfg.demo,
  }
})
