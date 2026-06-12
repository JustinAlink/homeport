import { readFileSync, writeFileSync, mkdirSync, existsSync, accessSync, constants } from 'node:fs'
import { join, dirname } from 'node:path'
import type { WebhookChannel } from './notifiers/types'

// UI-configurable settings, persisted to a JSON file in HOMEPORT_DATA_DIR.
// Env vars (read in config.ts) take precedence over these — they "lock" a field.
export interface PersistedSettings {
  dockerMode?: 'local' | 'ssh'
  dockerHost?: string // ssh://user@host when dockerMode==='ssh'
  dockerSshKey?: string // path to the private key
  dockerSshFingerprint?: string // SHA256:… of the remote host key (optional)
  domainProvider?: string // '' | 'npm' | 'traefik' | 'caddy' | 'nginx' | 'traefik-file'
  npmConfDir?: string
  caddyfilePath?: string
  nginxConfDir?: string
  traefikFilePath?: string
  allowControl?: boolean
  pingEnabled?: boolean
  systemdEnabled?: boolean
  remoteIcons?: boolean
  /** UI-managed multi-host list (empty = use the single connection above). */
  hosts?: SettingsHost[]
  /** Background collector cadence in seconds (feeds history + alerts). */
  collectorInterval?: number
  /** Persist CPU/mem history so graphs survive refresh/restart. */
  historyEnabled?: boolean
  /** Per-service alerting. */
  alertsEnabled?: boolean
  alertTransitions?: { down?: boolean; unhealthy?: boolean; recovered?: boolean }
  alertDebounceSamples?: number
  alertCooldownSec?: number
  alertChannels?: WebhookChannel[]
}

export interface SettingsHost {
  id?: string
  name: string
  dockerHost?: string // '' local, tcp://…, ssh://user@host
  dockerSshKey?: string
  sshFingerprint?: string // SHA256:… of the remote host key (optional)
  domainProvider?: string
  npmConfDir?: string
  caddyfilePath?: string
  nginxConfDir?: string
  traefikFilePath?: string
}

const dataDir = () => process.env.HOMEPORT_DATA_DIR || '/data'
const settingsFile = () => join(dataDir(), 'settings.json')

let cache: PersistedSettings | null = null

export function readSettings(): PersistedSettings {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(settingsFile(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache!
}

export function writeSettings(patch: PersistedSettings): PersistedSettings {
  const next = { ...readSettings(), ...patch }
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2))
  cache = next
  return next
}

export function settingsWritable(): boolean {
  try {
    if (existsSync(settingsFile())) {
      accessSync(settingsFile(), constants.W_OK)
      return true
    }
    // Dir may not exist yet — we can create it if the nearest existing ancestor is writable.
    let p = dataDir()
    while (!existsSync(p)) {
      const parent = dirname(p)
      if (parent === p) return false
      p = parent
    }
    accessSync(p, constants.W_OK)
    return true
  } catch {
    return false
  }
}
