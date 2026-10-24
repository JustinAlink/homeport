// Settings set by environment variables are "locked" on the settings page. Two
// rules keep the page honest (pure, unit-tested):
//  - it shows the EFFECTIVE value of a locked switch, not the saved one. With
//    HOMEPORT_ALERTS=true but alerts never switched on in the UI, the page showed
//    alerts as off and hid everything under that switch, so "Recovered" could not
//    be ticked and recoveries were never announced (seen live, 2026-10-25);
//  - saving never writes a locked field to settings.json: the environment owns it.
// Only switches and numbers are mirrored; secrets (tokens, keys, passwords) never
// travel to the browser.

/** env lock key (getEnvLocks) → the settings field it pins */
export const LOCKED_FIELDS = {
  alerts: 'alertsEnabled',
  allowControl: 'allowControl',
  logsEnabled: 'logsEnabled',
  updateCheckEnabled: 'updateCheckEnabled',
  allowUpdates: 'allowUpdates',
  allowStacks: 'allowStacks',
  allowTerminal: 'allowTerminal',
  allowContainerFiles: 'allowContainerFiles',
  allowProxyAdmin: 'allowProxyAdmin',
  pingEnabled: 'pingEnabled',
  systemdEnabled: 'systemdEnabled',
  remoteIcons: 'remoteIcons',
  historyEnabled: 'historyEnabled',
  collectorInterval: 'collectorInterval',
} as const

type Locks = Record<string, boolean>

/** The settings view with each locked field showing its effective value. */
export function withEffective<T extends object>(view: T, effective: object, locks: Locks): T {
  const out = { ...view } as Record<string, unknown>
  const eff = effective as Record<string, unknown>
  for (const [lock, field] of Object.entries(LOCKED_FIELDS)) {
    if (locks[lock] && field in eff) out[field] = eff[field]
  }
  return out as T
}

/** A save patch without the fields the environment pins. */
export function withoutLocked<T extends object>(patch: T, locks: Locks): T {
  const out = { ...patch } as Record<string, unknown>
  for (const [lock, field] of Object.entries(LOCKED_FIELDS)) {
    if (locks[lock]) delete out[field]
  }
  return out as T
}
