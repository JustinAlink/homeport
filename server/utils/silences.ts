import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from './config'
import { emptySilences, pruneSilences, silencedBy, type Silences, type SilenceReason } from '../../shared/utils/silence.ts'

// Snoozes and the global pause live in <data>/silences.json: they are operational
// state (they expire), unlike maintenance windows, which are configuration and
// live in settings. See shared/utils/silence.ts for the rules.

const file = () => join(process.env.HOMEPORT_DATA_DIR || '/data', 'silences.json')
let cache: Silences | null = null

export function readSilences(now = Date.now()): Silences {
  if (!cache) {
    try {
      const raw = JSON.parse(readFileSync(file(), 'utf8'))
      cache = { snoozes: raw?.snoozes && typeof raw.snoozes === 'object' ? raw.snoozes : {}, pausedUntil: Number(raw?.pausedUntil) || 0, ...(raw?.pauseNote ? { pauseNote: String(raw.pauseNote) } : {}) }
    } catch {
      cache = emptySilences() // none yet, or unreadable: nothing silenced (alerts fail open)
    }
  }
  return pruneSilences(cache!, now)
}

export function writeSilences(next: Silences): Silences {
  const dir = process.env.HOMEPORT_DATA_DIR || '/data'
  mkdirSync(dir, { recursive: true })
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, file())
  cache = next
  return next
}

/** The server's local day and minute: maintenance windows are entered in the server's time zone. */
export function localNow(now = Date.now()): { day: number; minute: number } {
  const d = new Date(now)
  return { day: d.getDay(), minute: d.getHours() * 60 + d.getMinutes() }
}

export const serverTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** Why alerts for this service key (or, with null, for anything) are silent now. */
export function silenceFor(key: string | null, now = Date.now()): SilenceReason | null {
  return silencedBy(key, now, localNow(now), readSilences(now), getConfig().maintenanceWindows)
}
