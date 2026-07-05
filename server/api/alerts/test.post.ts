import { dispatch } from '../../utils/alerts'
import { getConfig } from '../../utils/config'
import type { AlertEvent } from '../../utils/notifiers'

// Fire a synthetic alert through every configured channel and report per-channel
// results — powers the "Send test" button in settings. Does NOT touch the log.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (!cfg.alertChannels.length && !(cfg.smtpHost && cfg.smtpFrom && cfg.smtpTo)) {
    throw createError({ statusCode: 400, statusMessage: 'No webhook channels or email (SMTP) configured.' })
  }
  const event: AlertEvent = {
    id: 'test::homeport',
    name: 'homeport test',
    kind: 'down',
    from: 'running',
    to: 'exited',
    at: Date.now(),
  }
  const results = await dispatch(event, false)
  return { ok: results.every((r) => r.ok), channels: results }
})
