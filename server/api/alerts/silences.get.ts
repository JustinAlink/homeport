import { getConfig } from '../../utils/config'
import { readSilences, serverTimeZone, localNow } from '../../utils/silences'
import { inWindow } from '../../../shared/utils/silence.ts'

// What is silenced right now: snoozed apps, a global pause, the maintenance
// windows and whether one is running. The time zone is part of the answer
// because windows are entered in the server's local time, which in a container
// is often UTC rather than the browser's.
export default defineEventHandler(() => {
  const now = Date.now()
  const s = readSilences(now)
  const windows = getConfig().maintenanceWindows
  const local = localNow(now)
  return {
    snoozes: s.snoozes,
    pausedUntil: s.pausedUntil,
    pauseNote: s.pauseNote ?? null,
    windows,
    activeWindow: windows.find((w) => inWindow(w, local)) ?? null,
    timeZone: serverTimeZone(),
    serverTime: now,
    serverLocal: local,
  }
})
