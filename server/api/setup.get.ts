import { authMode } from '../utils/auth'
import { settingsWritable } from '../utils/settings'
import { MIN_PASSWORD_LENGTH } from '../utils/auth-core'

// Public: tells the login page which screen to show.
export default defineEventHandler(() => {
  const mode = authMode()
  return {
    needsSetup: mode === 'setup', // show the create-password screen
    open: mode === 'open', // running without a login → straight to the app
    writable: settingsWritable(), // false → can't persist a password (show a read-only warning)
    minPasswordLength: MIN_PASSWORD_LENGTH, // so the UI shows the rule up front
  }
})
