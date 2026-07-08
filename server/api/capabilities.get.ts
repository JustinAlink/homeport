import { getConfig } from '../utils/config'
import { authMode, trustedAuthHeader } from '../utils/auth'
import { SESSION_COOKIE, decodeSessionToken } from '../utils/session'
import { getUser } from '../utils/users'

// Which optional capabilities are enabled — the single source the UI uses to
// show/hide affordances (buttons, pages, panels). Auth-gated like all /api/*.
export default defineEventHandler((event) => {
  const cfg = getConfig()
  const session = decodeSessionToken(getCookie(event, SESSION_COOKIE))
  const viewer = !!session?.uid && !!getUser(session.uid)
  return {
    control: cfg.allowControl && !viewer,
    logs: cfg.logsEnabled,
    updateCheck: cfg.updateCheckEnabled,
    updates: cfg.allowUpdates && !viewer,
    stacks: cfg.allowStacks,
    terminal: cfg.allowTerminal && !viewer,
    proxyAdmin: cfg.allowProxyAdmin,
    // first-run / account hints (not secrets)
    loginDisabled: authMode() === 'open', // running without a login
    passwordEnvLocked: !!process.env.HOMEPORT_ADMIN_PASSWORD, // change-password unavailable
    forwardAuth: !!trustedAuthHeader(), // authenticated by an upstream proxy header
    demo: cfg.demo,
    viewer, // this session belongs to a read-only viewer account
  }
})
