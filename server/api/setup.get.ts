import { authMode } from '../utils/auth'
import { settingsWritable } from '../utils/settings'
import { MIN_PASSWORD_LENGTH } from '../utils/auth-core'
import { setupCode } from '../utils/setup'
import { getConfig } from '../utils/config'
import { ssoMissing } from '../utils/oidc'

// Public: tells the login page which screen to show. Never returns the setup
// code itself (that only goes to the log); it just makes sure one exists, so a
// return to setup mode after boot (a restore without a password) still logs one.
export default defineEventHandler(() => {
  const mode = authMode()
  const cfg = getConfig()
  const sso = mode === 'enforced' && !ssoMissing(cfg)
  if (mode === 'setup') setupCode()
  return {
    needsSetup: mode === 'setup', // show the create-password screen
    open: mode === 'open', // running without a login → straight to the app
    writable: settingsWritable(), // false → can't persist a password (show a read-only warning)
    minPasswordLength: MIN_PASSWORD_LENGTH, // so the UI shows the rule up front
    // single sign-on: only whether to offer it and how, never the provider's details
    sso: sso ? { label: cfg.oidcButtonLabel, autoRedirect: cfg.oidcAutoRedirect, hidePassword: cfg.oidcHidePassword } : null,
  }
})
