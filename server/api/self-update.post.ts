import { getConfig } from '../utils/config'
import { launchSelfUpdate } from '../utils/self-update'

// Update homeport itself: launches the detached helper (compose pull + up -d
// from outside this container). The response races homeport's own recreation —
// the client should expect the connection to drop and poll /api/version.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) {
    await new Promise((r) => setTimeout(r, 800))
    return { ok: true, helper: 'demo' }
  }
  if (!cfg.allowUpdates) {
    throw createError({ statusCode: 403, statusMessage: 'Applying updates is disabled (HOMEPORT_ALLOW_UPDATES=true to enable).' })
  }
  const res = await launchSelfUpdate()
  if (!res.ok) throw createError({ statusCode: 409, statusMessage: res.reason })
  return res
})
