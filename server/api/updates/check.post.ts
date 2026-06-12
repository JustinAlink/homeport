import { getConfig } from '../../utils/config'
import { runUpdateSweep, getUpdateMap } from '../../utils/updates'
import { demoUpdates } from '../../utils/demo'

// "Check now": force a full sweep across all hosts/images, ignoring the interval.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) return { ok: true, entries: demoUpdates() }
  if (!cfg.updateCheckEnabled) {
    throw createError({ statusCode: 403, statusMessage: 'Update checks are disabled (HOMEPORT_UPDATE_CHECK=true to enable).' })
  }
  const ran = await runUpdateSweep(true)
  return { ok: ran !== null, entries: getUpdateMap() } // null = a sweep was already running
})
