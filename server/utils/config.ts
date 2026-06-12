// Effective runtime config. Resolution order per field: ENV (locks it) → persisted
// settings file (UI-editable) → default. So a single prebuilt image is configurable at
// container start (env) AND via the in-app settings page (when env doesn't lock it).

import { readSettings, type PersistedSettings } from './settings'
import type { WebhookChannel } from './notifiers/types'

export interface AlertTransitions {
  down: boolean
  unhealthy: boolean
  recovered: boolean
}

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
  /** Optional SHA256:… fingerprint to pin the remote host key for ssh:// DOCKER_HOST. */
  dockerSshFingerprint: string
  /** Explicit reverse-proxy provider: 'npm' | 'traefik' | 'caddy'. Empty = auto-detect. */
  domainProvider: string
  /** Directory of Nginx Proxy Manager generated proxy-host confs. */
  npmConfDir: string
  /** Path to a Caddyfile (for the caddy provider). */
  caddyfilePath: string
  /** Directory of plain Nginx server confs (sites-enabled / conf.d), or a single file. */
  nginxConfDir: string
  /** Path to a Traefik dynamic-config file/dir (YAML/TOML) for the file provider. */
  traefikFilePath: string
  /** Proxy-admin (write) credentials for the single host. */
  npmApiUrl: string
  npmApiIdentity: string
  npmApiSecret: string
  caddyAdminUrl: string
  /** Serve a synthetic fleet (no Docker needed) — for trying homeport / screenshots. */
  demo: boolean
  /** Allow start/stop/restart controls. Off by default — homeport is read-only unless opted in. */
  allowControl: boolean
  /** Container logs viewer. On by default (read-tier; covered by CONTAINERS=1 on the proxy). */
  logsEnabled: boolean
  /** Check registries for newer images (needs DISTRIBUTION=1 on the proxy). Off by default. */
  updateCheckEnabled: boolean
  /** Hours between update sweeps per image (registry checks count toward Hub pull limits). */
  updateCheckIntervalH: number
  /** Allow applying image updates: pull + recreate (needs IMAGES=1 POST=1). Off by default. */
  allowUpdates: boolean
  /** Compose stack management from a mounted stacks dir (needs broad proxy perms). Off by default. */
  allowStacks: boolean
  /** Directory of compose stacks (each subdir = one stack). */
  stacksDir: string
  /** Web terminal: exec into containers (needs EXEC=1 POST=1). Off by default. */
  allowTerminal: boolean
  /** Manage the reverse proxy (create/edit domains) via provider APIs. Off by default. */
  allowProxyAdmin: boolean
  /** Actively HTTP-ping mapped domains for an up/down indicator. On by default. */
  pingEnabled: boolean
  /** Also show host systemd services (best-effort; needs systemctl access). Off by default. */
  systemdEnabled: boolean
  /** Optional allowlist of systemd units to show (empty = active + failed). */
  systemdUnits: string[]
  /** Fetch real app logos from the dashboard-icons CDN. On by default. */
  remoteIcons: boolean
  /** Background collector cadence in seconds (feeds history + alerts). Min 10. */
  collectorInterval: number
  /** Persist CPU/mem history so graphs survive refresh/restart. On by default. */
  historyEnabled: boolean
  /** Seconds per history point (downsample resolution). Advanced/env-only. */
  historyResolution: number
  /** Hours of history to retain per series. Advanced/env-only. */
  historyRetentionHours: number
  /** Max number of tracked series (bounds disk). Advanced/env-only. */
  historyMaxSeries: number
  /** Per-service alerting on down/unhealthy/recovered transitions. Off by default. */
  alertsEnabled: boolean
  /** Which transitions to notify on. */
  alertTransitions: AlertTransitions
  /** Consecutive bad samples before an alert fires (anti-flap). */
  alertDebounceSamples: number
  /** Min seconds between repeat notifications while a service stays bad (0 = once). */
  alertCooldownSec: number
  /** Outbound webhook channels. */
  alertChannels: WebhookChannel[]
}

const envStr = (k: string) => {
  const v = process.env[k]
  return v !== undefined && v !== '' ? v : undefined
}

const envNum = (k: string) => {
  const v = envStr(k)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
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
    dockerSshFingerprint: envStr('DOCKER_SSH_FINGERPRINT') ?? s.dockerSshFingerprint ?? '',
    domainProvider: (envStr('DOMAIN_PROVIDER') ?? s.domainProvider ?? '').toLowerCase(),
    npmConfDir: envStr('NPM_CONF_DIR') ?? s.npmConfDir ?? '',
    caddyfilePath: envStr('CADDYFILE_PATH') ?? s.caddyfilePath ?? '',
    nginxConfDir: envStr('NGINX_CONF_DIR') ?? s.nginxConfDir ?? '',
    traefikFilePath: envStr('TRAEFIK_FILE') ?? s.traefikFilePath ?? '',
    npmApiUrl: envStr('HOMEPORT_NPM_API_URL') ?? s.npmApiUrl ?? '',
    npmApiIdentity: envStr('HOMEPORT_NPM_API_IDENTITY') ?? s.npmApiIdentity ?? '',
    npmApiSecret: envStr('HOMEPORT_NPM_API_SECRET') ?? s.npmApiSecret ?? '',
    caddyAdminUrl: envStr('HOMEPORT_CADDY_ADMIN_URL') ?? s.caddyAdminUrl ?? '',
    allowControl:
      envStr('HOMEPORT_ALLOW_CONTROL') !== undefined
        ? process.env.HOMEPORT_ALLOW_CONTROL === 'true'
        : !!s.allowControl,
    logsEnabled:
      envStr('HOMEPORT_LOGS') !== undefined
        ? process.env.HOMEPORT_LOGS === 'true'
        : s.logsEnabled ?? true,
    updateCheckEnabled:
      envStr('HOMEPORT_UPDATE_CHECK') !== undefined
        ? process.env.HOMEPORT_UPDATE_CHECK === 'true'
        : !!s.updateCheckEnabled,
    updateCheckIntervalH: Math.max(1, envNum('HOMEPORT_UPDATE_CHECK_INTERVAL_H') ?? 24),
    allowUpdates:
      envStr('HOMEPORT_ALLOW_UPDATES') !== undefined
        ? process.env.HOMEPORT_ALLOW_UPDATES === 'true'
        : !!s.allowUpdates,
    allowStacks:
      envStr('HOMEPORT_ALLOW_STACKS') !== undefined
        ? process.env.HOMEPORT_ALLOW_STACKS === 'true'
        : !!s.allowStacks,
    stacksDir: envStr('HOMEPORT_STACKS_DIR') ?? '/stacks',
    allowTerminal:
      envStr('HOMEPORT_ALLOW_TERMINAL') !== undefined
        ? process.env.HOMEPORT_ALLOW_TERMINAL === 'true'
        : !!s.allowTerminal,
    allowProxyAdmin:
      envStr('HOMEPORT_ALLOW_PROXY_ADMIN') !== undefined
        ? process.env.HOMEPORT_ALLOW_PROXY_ADMIN === 'true'
        : !!s.allowProxyAdmin,
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
    remoteIcons:
      envStr('HOMEPORT_REMOTE_ICONS') !== undefined
        ? process.env.HOMEPORT_REMOTE_ICONS === 'true'
        : s.remoteIcons ?? true,
    collectorInterval: Math.max(10, envNum('HOMEPORT_COLLECTOR_INTERVAL') ?? s.collectorInterval ?? 30),
    historyEnabled:
      envStr('HOMEPORT_HISTORY') !== undefined
        ? process.env.HOMEPORT_HISTORY === 'true'
        : s.historyEnabled ?? true,
    historyResolution: Math.max(15, envNum('HOMEPORT_HISTORY_RESOLUTION') ?? 60),
    historyRetentionHours: Math.max(1, envNum('HOMEPORT_HISTORY_RETENTION_HOURS') ?? 24),
    historyMaxSeries: Math.max(10, envNum('HOMEPORT_HISTORY_MAX_SERIES') ?? 500),
    alertsEnabled:
      envStr('HOMEPORT_ALERTS') !== undefined
        ? process.env.HOMEPORT_ALERTS === 'true'
        : s.alertsEnabled ?? false,
    alertTransitions: {
      down: s.alertTransitions?.down ?? true,
      unhealthy: s.alertTransitions?.unhealthy ?? true,
      recovered: s.alertTransitions?.recovered ?? false,
    },
    alertDebounceSamples: Math.max(1, s.alertDebounceSamples ?? 3),
    alertCooldownSec: Math.max(0, s.alertCooldownSec ?? 3600),
    alertChannels: s.alertChannels ?? [],
  }
}

/** Which UI-editable fields are locked by an env var (the settings page disables these). */
export function getEnvLocks() {
  return {
    docker: envStr('DOCKER_HOST') !== undefined,
    dockerSshKey: envStr('DOCKER_SSH_KEY') !== undefined,
    dockerSshFingerprint: envStr('DOCKER_SSH_FINGERPRINT') !== undefined,
    domainProvider: envStr('DOMAIN_PROVIDER') !== undefined,
    npmConfDir: envStr('NPM_CONF_DIR') !== undefined,
    caddyfilePath: envStr('CADDYFILE_PATH') !== undefined,
    nginxConfDir: envStr('NGINX_CONF_DIR') !== undefined,
    traefikFilePath: envStr('TRAEFIK_FILE') !== undefined,
    npmApiUrl: envStr('HOMEPORT_NPM_API_URL') !== undefined,
    npmApiIdentity: envStr('HOMEPORT_NPM_API_IDENTITY') !== undefined,
    npmApiSecret: envStr('HOMEPORT_NPM_API_SECRET') !== undefined,
    caddyAdminUrl: envStr('HOMEPORT_CADDY_ADMIN_URL') !== undefined,
    allowControl: envStr('HOMEPORT_ALLOW_CONTROL') !== undefined,
    logsEnabled: envStr('HOMEPORT_LOGS') !== undefined,
    updateCheckEnabled: envStr('HOMEPORT_UPDATE_CHECK') !== undefined,
    allowUpdates: envStr('HOMEPORT_ALLOW_UPDATES') !== undefined,
    allowStacks: envStr('HOMEPORT_ALLOW_STACKS') !== undefined,
    allowTerminal: envStr('HOMEPORT_ALLOW_TERMINAL') !== undefined,
    allowProxyAdmin: envStr('HOMEPORT_ALLOW_PROXY_ADMIN') !== undefined,
    pingEnabled: envStr('HOMEPORT_PING') !== undefined,
    systemdEnabled: envStr('HOMEPORT_SYSTEMD') !== undefined,
    remoteIcons: envStr('HOMEPORT_REMOTE_ICONS') !== undefined,
    hosts: !!process.env.HOMEPORT_HOSTS,
    collectorInterval: envNum('HOMEPORT_COLLECTOR_INTERVAL') !== undefined,
    historyEnabled: envStr('HOMEPORT_HISTORY') !== undefined,
    alerts: envStr('HOMEPORT_ALERTS') !== undefined,
  }
}

/** Current persisted (UI) settings with sensible defaults filled in. */
export function getSettingsView(): Required<Pick<PersistedSettings, 'dockerMode'>> & PersistedSettings {
  const s = readSettings()
  return {
    dockerMode: s.dockerMode || 'local',
    dockerHost: s.dockerHost || '',
    dockerSshKey: s.dockerSshKey || '',
    dockerSshFingerprint: s.dockerSshFingerprint || '',
    domainProvider: s.domainProvider || '',
    npmConfDir: s.npmConfDir || '',
    caddyfilePath: s.caddyfilePath || '',
    nginxConfDir: s.nginxConfDir || '',
    traefikFilePath: s.traefikFilePath || '',
    npmApiUrl: s.npmApiUrl || '',
    npmApiIdentity: s.npmApiIdentity || '',
    npmApiSecret: s.npmApiSecret || '',
    caddyAdminUrl: s.caddyAdminUrl || '',
    allowControl: !!s.allowControl,
    logsEnabled: s.logsEnabled ?? true,
    updateCheckEnabled: !!s.updateCheckEnabled,
    allowUpdates: !!s.allowUpdates,
    allowStacks: !!s.allowStacks,
    allowTerminal: !!s.allowTerminal,
    allowProxyAdmin: !!s.allowProxyAdmin,
    pingEnabled: s.pingEnabled ?? true,
    systemdEnabled: !!s.systemdEnabled,
    remoteIcons: s.remoteIcons ?? true,
    hosts: s.hosts ?? [],
    collectorInterval: s.collectorInterval ?? 30,
    historyEnabled: s.historyEnabled ?? true,
    alertsEnabled: s.alertsEnabled ?? false,
    alertTransitions: {
      down: s.alertTransitions?.down ?? true,
      unhealthy: s.alertTransitions?.unhealthy ?? true,
      recovered: s.alertTransitions?.recovered ?? false,
    },
    alertDebounceSamples: s.alertDebounceSamples ?? 3,
    alertCooldownSec: s.alertCooldownSec ?? 3600,
    alertChannels: s.alertChannels ?? [],
  }
}
