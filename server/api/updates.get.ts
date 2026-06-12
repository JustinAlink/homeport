import { getConfig } from '../utils/config'
import { getUpdateMap } from '../utils/updates'
import { demoUpdates } from '../utils/demo'

// Current image-update statuses, keyed `${hostId}|${image}`.
export default defineEventHandler(() => {
  const cfg = getConfig()
  if (!cfg.updateCheckEnabled && !cfg.demo) return { enabled: false, entries: {} }
  return { enabled: true, entries: cfg.demo ? demoUpdates() : getUpdateMap() }
})
