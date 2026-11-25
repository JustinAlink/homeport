import { getConfig } from '../utils/config'
import { runCollectorTick } from '../utils/collector'
import { flush } from '../utils/history'
import { log } from '../utils/log'

// Background collector: periodically snapshots the fleet so history + alerts have
// data without a user looking at the page. Nitro auto-loads server/plugins/*.
// node-server is a single process, so one interval per deployment.
export default defineNitroPlugin((nitroApp) => {
  const cfg = getConfig()

  // Demo mode is synthetic — history/alerts would be meaningless, so don't run.
  if (cfg.demo) return

  // Kick once on boot so history/alerts populate without waiting a full interval.
  runCollectorTick().catch((e) => log.error('collector', 'boot tick failed', e))

  // A timer that re-reads the interval before every wait, so changing it in
  // Settings takes effect from the next tick. A fixed setInterval kept the boot
  // value until a restart, and the page gave no hint of that.
  let handle: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const schedule = () => {
    if (stopped) return
    handle = setTimeout(() => {
      // Never let a background-loop rejection vanish silently — that used to mean
      // history + alerts just stopped with nothing in the logs to explain why.
      runCollectorTick()
        .catch((e) => log.error('collector', 'tick failed', e))
        .finally(schedule)
    }, Math.max(10, getConfig().collectorInterval) * 1000)
    // Don't keep the event loop alive solely for the collector.
    if (typeof handle.unref === 'function') handle.unref()
  }
  schedule()

  nitroApp.hooks.hook('close', () => {
    stopped = true
    if (handle) clearTimeout(handle)
    flush() // persist any buffered history on shutdown
  })
})
