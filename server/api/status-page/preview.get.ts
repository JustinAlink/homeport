import { getConfig, getEnvLocks } from '../../utils/config'
import { computePublicStatus } from '../../utils/status-page'
import { normalizeTzOffset } from '../../../shared/utils/status-page.ts'

// GET /api/status-page/preview[?tz=...]: the public status page exactly as a
// visitor would get it, also while it is switched off, plus whether it is on.
// Behind the normal login and admin-only (READ_DENY): it shows the page an
// admin is preparing. Uncached, so a saved change shows on the next load.
export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const cfg = getConfig()
  return {
    ...computePublicStatus(normalizeTzOffset(getQuery(event).tz)),
    preview: { enabled: cfg.statusPageEnabled, locked: getEnvLocks().statusPage },
  }
})
