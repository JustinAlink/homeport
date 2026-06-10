import { writeSettings, settingsWritable, type PersistedSettings } from '../utils/settings'
import { resetDocker } from '../utils/docker'

const PROVIDERS = ['', 'npm', 'traefik', 'caddy']

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

  const saved = writeSettings(patch)
  resetDocker() // a connection change should take effect immediately
  return { ok: true, settings: saved }
})
