import { getConfig } from '../utils/config'
import { recentAlerts } from '../utils/alerts'
import { listOps } from '../utils/ops'
import { demoActivity } from '../utils/demo'

// One feed for the Activity page: recent alert events (state changes, update
// notifications, auto-update results) + recent server operations (compose
// runs, installs). Read-tier — auth-protected by the global middleware.
export default defineEventHandler(() => {
  const cfg = getConfig()
  if (cfg.demo) return { events: demoActivity(), ops: listOps() }
  return { events: recentAlerts(200), ops: listOps() }
})
