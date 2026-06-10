// Effective runtime config. Resolution order per field: ENV (locks it) → persisted
// settings file (UI-editable) → default. So a single prebuilt image is configurable at
// container start (env) AND via the in-app settings page (when env doesn't lock it).

import { readSettings, type PersistedSettings } from './settings'

export interface HomeportConfig {
  /** Password for the single admin login. Empty = login disabled (NOT recommended). */
  adminPassword: string
  /** Secret used to sign the session cookie. */
  sessionSecret: string
  /** Where Docker lives: ssh://user@host, tcp://host:port, or empty for the unix socket. */
  dockerHost: string
  /** Path to the Docker unix socket (when dockerHost is empty). */
  dockerSocket: string
  /** Private key path for ssh:// DOCKER_HOST (falls back to the SSH agent if unset). */
  dockerSshKey: string
  /** Optional passphrase for the SSH key. */
  dockerSshPassphrase: string
  /** Explicit reverse-proxy provider: 'npm' | 'traefik' | 'caddy'. Empty = auto-detect. */
  domainProvider: string
  /** Directory of Nginx Proxy Manager generated proxy-host confs. */
  npmConfDir: string
  /** Path to a Caddyfile (for the caddy provider). */
  caddyfilePath: string
  /** Serve a synthetic fleet (no Docker needed) — for trying homeport / screenshots. */
  demo: boolean
  /** Allow start/stop controls. Off by default — homeport is read-only unless opted in. */
  allowControl: boolean
  /** Actively HTTP-ping mapped domains for an up/down indicator. On by default. */
  pingEnabled: boolean
  /** Also show host systemd services (best-effort; needs systemctl access). Off by default. */
  systemdEnabled: boolean
  /** Optional allowlist of systemd units to show (empty = active + failed). */
  systemdUnits: string[]
}

const envStr = (k: string) => {
  const v = process.env[k]
  return v !== undefined && v !== '' ? v : undefined
}

export function getConfig(): HomeportConfig {
  const s = readSettings()
  const dockerHostFromSettings = s.dockerMode === 'ssh' ? s.dockerHost || '' : ''

  return {
    // env-only (security-sensitive)
    adminPassword: process.env.HOMEPORT_ADMIN_PASSWORD ?? '',
    sessionSecret: process.env.HOMEPORT_SESSION_SECRET || 'insecure-dev-secret-change-me',
    dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    dockerSshPassphrase: process.env.DOCKER_SSH_KEY_PASSPHRASE ?? '',
    demo: process.env.HOMEPORT_DEMO === 'true',

    // env → settings → default
    dockerHost: envStr('DOCKER_HOST') ?? dockerHostFromSettings,
    dockerSshKey: envStr('DOCKER_SSH_KEY') ?? s.dockerSshKey ?? '',
    domainProvider: (envStr('DOMAIN_PROVIDER') ?? s.domainProvider ?? '').toLowerCase(),
    npmConfDir: envStr('NPM_CONF_DIR') ?? s.npmConfDir ?? '',
    caddyfilePath: envStr('CADDYFILE_PATH') ?? s.caddyfilePath ?? '',
    allowControl:
      envStr('HOMEPORT_ALLOW_CONTROL') !== undefined
        ? process.env.HOMEPORT_ALLOW_CONTROL === 'true'
        : !!s.allowControl,
    pingEnabled:
      envStr('HOMEPORT_PING') !== undefined
        ? process.env.HOMEPORT_PING === 'true'
        : s.pingEnabled ?? true,
    systemdEnabled:
      envStr('HOMEPORT_SYSTEMD') !== undefined
        ? process.env.HOMEPORT_SYSTEMD === 'true'
        : !!s.systemdEnabled,
    systemdUnits: (envStr('HOMEPORT_SYSTEMD_UNITS') || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  }
}

/** Which UI-editable fields are locked by an env var (the settings page disables these). */
export function getEnvLocks() {
  return {
    docker: envStr('DOCKER_HOST') !== undefined,
    dockerSshKey: envStr('DOCKER_SSH_KEY') !== undefined,
    domainProvider: envStr('DOMAIN_PROVIDER') !== undefined,
    npmConfDir: envStr('NPM_CONF_DIR') !== undefined,
    caddyfilePath: envStr('CADDYFILE_PATH') !== undefined,
    allowControl: envStr('HOMEPORT_ALLOW_CONTROL') !== undefined,
    pingEnabled: envStr('HOMEPORT_PING') !== undefined,
    systemdEnabled: envStr('HOMEPORT_SYSTEMD') !== undefined,
  }
}

/** Current persisted (UI) settings with sensible defaults filled in. */
export function getSettingsView(): Required<Pick<PersistedSettings, 'dockerMode'>> & PersistedSettings {
  const s = readSettings()
  return {
    dockerMode: s.dockerMode || 'local',
    dockerHost: s.dockerHost || '',
    dockerSshKey: s.dockerSshKey || '',
    domainProvider: s.domainProvider || '',
    npmConfDir: s.npmConfDir || '',
    caddyfilePath: s.caddyfilePath || '',
    allowControl: !!s.allowControl,
    pingEnabled: s.pingEnabled ?? true,
    systemdEnabled: !!s.systemdEnabled,
  }
}
