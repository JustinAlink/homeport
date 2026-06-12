import { writeSettings, settingsWritable, type PersistedSettings, type SettingsHost } from '../utils/settings'
import { resetDocker } from '../utils/docker'
import type { WebhookChannel, WebhookPreset } from '../utils/notifiers/types'

const PROVIDERS = ['', 'npm', 'traefik', 'caddy', 'nginx', 'traefik-file']
const PRESETS: WebhookPreset[] = ['discord', 'slack', 'ntfy', 'custom']

function sanitizeChannels(input: unknown): WebhookChannel[] {
  if (!Array.isArray(input)) throw createError({ statusCode: 400, statusMessage: 'alertChannels must be an array' })
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return input
    .map((c): WebhookChannel => {
      const o = (c ?? {}) as Record<string, unknown>
      const url = str(o.url)
      if (url && !/^https?:\/\//.test(url))
        throw createError({ statusCode: 400, statusMessage: 'channel url must be http(s)://' })
      const preset = (str(o.preset) || 'custom') as WebhookPreset
      if (!PRESETS.includes(preset))
        throw createError({ statusCode: 400, statusMessage: 'invalid channel preset' })
      return { name: str(o.name) || preset, url, preset, template: str(o.template) || undefined }
    })
    .filter((c) => c.url)
}

function sanitizeHosts(input: unknown): SettingsHost[] {
  if (!Array.isArray(input)) throw createError({ statusCode: 400, statusMessage: 'hosts must be an array' })
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return input
    .map((h): SettingsHost => {
      const o = (h ?? {}) as Record<string, unknown>
      const dockerHost = str(o.dockerHost)
      if (dockerHost && !/^(ssh|tcp):\/\//.test(dockerHost))
        throw createError({ statusCode: 400, statusMessage: 'host dockerHost must be ssh:// or tcp://' })
      const domainProvider = str(o.domainProvider)
      if (domainProvider && !PROVIDERS.includes(domainProvider))
        throw createError({ statusCode: 400, statusMessage: 'invalid host domainProvider' })
      return {
        id: str(o.id),
        name: str(o.name) || str(o.id) || 'host',
        dockerHost,
        dockerSshKey: str(o.dockerSshKey),
        sshFingerprint: str(o.sshFingerprint),
        domainProvider,
        npmConfDir: str(o.npmConfDir),
        caddyfilePath: str(o.caddyfilePath),
        nginxConfDir: str(o.nginxConfDir),
        traefikFilePath: str(o.traefikFilePath),
        npmApiUrl: str(o.npmApiUrl),
        npmApiIdentity: str(o.npmApiIdentity),
        npmApiSecret: str(o.npmApiSecret),
        caddyAdminUrl: str(o.caddyAdminUrl),
      }
    })
    .filter((h) => h.name)
}

export default defineEventHandler(async (event) => {
  if (!settingsWritable()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Settings storage is not writable. Mount a writable HOMEPORT_DATA_DIR volume.',
    })
  }

  const body = await readBody<PersistedSettings>(event)
  const patch: PersistedSettings = {}

  if (body.dockerMode !== undefined) {
    if (body.dockerMode !== 'local' && body.dockerMode !== 'ssh')
      throw createError({ statusCode: 400, statusMessage: 'dockerMode must be local | ssh' })
    patch.dockerMode = body.dockerMode
  }
  if (body.dockerHost !== undefined) {
    if (body.dockerHost && !body.dockerHost.startsWith('ssh://'))
      throw createError({ statusCode: 400, statusMessage: 'dockerHost must be ssh://user@host' })
    patch.dockerHost = body.dockerHost.trim()
  }
  if (body.dockerSshKey !== undefined) patch.dockerSshKey = body.dockerSshKey.trim()
  if (body.dockerSshFingerprint !== undefined) patch.dockerSshFingerprint = body.dockerSshFingerprint.trim()
  if (body.domainProvider !== undefined) {
    if (!PROVIDERS.includes(body.domainProvider))
      throw createError({ statusCode: 400, statusMessage: 'invalid domainProvider' })
    patch.domainProvider = body.domainProvider
  }
  if (body.npmConfDir !== undefined) patch.npmConfDir = body.npmConfDir.trim()
  if (body.caddyfilePath !== undefined) patch.caddyfilePath = body.caddyfilePath.trim()
  if (body.nginxConfDir !== undefined) patch.nginxConfDir = body.nginxConfDir.trim()
  if (body.traefikFilePath !== undefined) patch.traefikFilePath = body.traefikFilePath.trim()
  if (body.npmApiUrl !== undefined) {
    const v = body.npmApiUrl.trim()
    if (v && !/^https?:\/\//.test(v)) throw createError({ statusCode: 400, statusMessage: 'npmApiUrl must be http(s)://' })
    patch.npmApiUrl = v
  }
  if (body.npmApiIdentity !== undefined) patch.npmApiIdentity = body.npmApiIdentity.trim()
  if (body.npmApiSecret !== undefined) patch.npmApiSecret = body.npmApiSecret
  if (body.caddyAdminUrl !== undefined) {
    const v = body.caddyAdminUrl.trim()
    if (v && !/^https?:\/\//.test(v)) throw createError({ statusCode: 400, statusMessage: 'caddyAdminUrl must be http(s)://' })
    patch.caddyAdminUrl = v
  }
  if (body.allowControl !== undefined) patch.allowControl = !!body.allowControl
  if (body.logsEnabled !== undefined) patch.logsEnabled = !!body.logsEnabled
  if (body.updateCheckEnabled !== undefined) patch.updateCheckEnabled = !!body.updateCheckEnabled
  if (body.allowUpdates !== undefined) patch.allowUpdates = !!body.allowUpdates
  if (body.allowStacks !== undefined) patch.allowStacks = !!body.allowStacks
  if (body.allowTerminal !== undefined) patch.allowTerminal = !!body.allowTerminal
  if (body.allowProxyAdmin !== undefined) patch.allowProxyAdmin = !!body.allowProxyAdmin
  if (body.pingEnabled !== undefined) patch.pingEnabled = !!body.pingEnabled
  if (body.systemdEnabled !== undefined) patch.systemdEnabled = !!body.systemdEnabled
  if (body.remoteIcons !== undefined) patch.remoteIcons = !!body.remoteIcons
  if (body.hosts !== undefined) patch.hosts = sanitizeHosts(body.hosts)
  if (body.collectorInterval !== undefined) {
    const n = Number(body.collectorInterval)
    if (!Number.isFinite(n) || n < 10)
      throw createError({ statusCode: 400, statusMessage: 'collectorInterval must be ≥ 10 seconds' })
    patch.collectorInterval = Math.round(n)
  }
  if (body.historyEnabled !== undefined) patch.historyEnabled = !!body.historyEnabled

  if (body.alertsEnabled !== undefined) patch.alertsEnabled = !!body.alertsEnabled
  if (body.alertTransitions !== undefined) {
    const t = body.alertTransitions || {}
    patch.alertTransitions = { down: !!t.down, unhealthy: !!t.unhealthy, recovered: !!t.recovered }
  }
  if (body.alertDebounceSamples !== undefined) {
    const n = Number(body.alertDebounceSamples)
    if (!Number.isFinite(n) || n < 1)
      throw createError({ statusCode: 400, statusMessage: 'alertDebounceSamples must be ≥ 1' })
    patch.alertDebounceSamples = Math.round(n)
  }
  if (body.alertCooldownSec !== undefined) {
    const n = Number(body.alertCooldownSec)
    if (!Number.isFinite(n) || n < 0)
      throw createError({ statusCode: 400, statusMessage: 'alertCooldownSec must be ≥ 0' })
    patch.alertCooldownSec = Math.round(n)
  }
  if (body.alertChannels !== undefined) patch.alertChannels = sanitizeChannels(body.alertChannels)

  const saved = writeSettings(patch)
  resetDocker() // a connection change should take effect immediately
  return { ok: true, settings: saved }
})
