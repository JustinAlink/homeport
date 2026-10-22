import { getConfig } from '../utils/config'
import { replaceSettings, settingsWritable, type PersistedSettings } from '../utils/settings'
import { restoreAuthFile } from '../utils/auth'
import { saveToken } from '../utils/git-stacks'
import { safeStackName } from '../utils/stacks-core'
import { log } from '../utils/log'

// Restore a backup produced by GET /api/backup. Settings are replaced (not
// merged); the auth file is replaced when present — which invalidates all
// sessions, including the caller's (the UI sends them back to the login page).
export default defineEventHandler(async (event) => {
  if (getConfig().demo) {
    throw createError({ statusCode: 403, statusMessage: 'Demo mode is read-only — restore is disabled.' })
  }
  if (!settingsWritable()) {
    throw createError({ statusCode: 409, statusMessage: 'The data dir is not writable — nothing to restore into.' })
  }

  const body = await readBody<{
    format?: string
    version?: number
    settings?: PersistedSettings
    auth?: { passwordHash?: string; sessionSecret?: string; sessionGeneration?: number }
    gitTokens?: Record<string, string>
  }>(event)

  if (body?.format !== 'homeport-backup' || typeof body.version !== 'number') {
    throw createError({ statusCode: 400, statusMessage: 'Not a homeport backup file.' })
  }
  if (body.version > 1) {
    throw createError({ statusCode: 400, statusMessage: `Backup format v${body.version} is newer than this homeport understands.` })
  }
  if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
    throw createError({ statusCode: 400, statusMessage: 'Backup contains no settings object.' })
  }

  try {
    replaceSettings(body.settings)

    let authRestored = false
    if (body.auth && typeof body.auth === 'object') {
      restoreAuthFile(body.auth)
      authRestored = true
    }

    let tokens = 0
    for (const [name, token] of Object.entries(body.gitTokens ?? {})) {
      if (safeStackName(name) && typeof token === 'string' && token) {
        saveToken(name, token)
        tokens++
      }
    }

    return { ok: true, authRestored, gitTokens: tokens }
  } catch (e: any) {
    // A mid-restore write failure (volume flipped read-only, disk full) must
    // reach the client as a clear message, not a bare 500.
    log.error('backup', 'restore failed while writing', e)
    throw createError({ statusCode: 500, statusMessage: `Restore failed while writing: ${e?.message || e}` })
  }
})
