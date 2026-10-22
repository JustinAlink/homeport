import { generateSetupCode } from './setup-core'
import { log } from './log'

// The first-run setup code (see setup-core for why it exists). In memory only:
// nothing secret is left on disk, and every restart makes a new code and logs
// it, so a code that leaked from an old log stops working.

let current = ''

/** The current setup code, made and logged on first use. */
export function setupCode(): string {
  if (!current) {
    current = generateSetupCode()
    log.announce(
      'setup',
      `no admin password yet. To finish first-run setup, open homeport in your browser and enter this setup code: ${current}`,
    )
  }
  return current
}

/** Setup is done: retire the code, so a later return to setup mode makes a fresh one. */
export function retireSetupCode(): void {
  current = ''
}
