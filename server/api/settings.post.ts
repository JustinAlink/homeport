import { writeSettings, settingsWritable, type PersistedSettings, type SettingsHost } from '../utils/settings'
import { resetDocker } from '../utils/docker'

const PROVIDERS = ['', 'npm', 'traefik', 'caddy']

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
  if (body.domainProvider !== undefined) {
    if (!PROVIDERS.includes(body.domainProvider))
      throw createError({ statusCode: 400, statusMessage: 'invalid domainProvider' })
    patch.domainProvider = body.domainProvider
  }
  if (body.npmConfDir !== undefined) patch.npmConfDir = body.npmConfDir.trim()
  if (body.caddyfilePath !== undefined) patch.caddyfilePath = body.caddyfilePath.trim()
  if (body.allowControl !== undefined) patch.allowControl = !!body.allowControl
  if (body.pingEnabled !== undefined) patch.pingEnabled = !!body.pingEnabled
  if (body.systemdEnabled !== undefined) patch.systemdEnabled = !!body.systemdEnabled
  if (body.remoteIcons !== undefined) patch.remoteIcons = !!body.remoteIcons
  if (body.hosts !== undefined) patch.hosts = sanitizeHosts(body.hosts)

  const saved = writeSettings(patch)
  resetDocker() // a connection change should take effect immediately
  return { ok: true, settings: saved }
})
