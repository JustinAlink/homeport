import { authMode } from '../utils/auth'

// Public: tells the login page which screen to show.
export default defineEventHandler(() => {
  const mode = authMode()
  return {
    needsSetup: mode === 'setup', // show the create-password screen
    open: mode === 'open', // running without a login → straight to the app
  }
})
