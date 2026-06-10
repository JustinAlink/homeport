import { getConfig } from '../utils/config'
import { runCollectorTick } from '../utils/collector'
import { flush } from '../utils/history'

// Background collector: periodically snapshots the fleet so history + alerts have
// data without a user looking at the page. Nitro auto-loads server/plugins/*.
// node-server is a single process, so one interval per deployment.
export default defineNitroPlugin((nitroApp) => {
  const cfg = getConfig()

  // Demo mode is synthetic — history/alerts would be meaningless, so don't run.
  if (cfg.demo) return

  const intervalMs = Math.max(10, cfg.collectorInterval) * 1000

  // Kick once on boot so history/alerts populate without waiting a full interval.
  runCollectorTick().catch(() => {})

  const handle = setInterval(() => {
    runCollectorTick().catch(() => {})
  }, intervalMs)
  // Don't keep the event loop alive solely for the collector.
  if (typeof handle.unref === 'function') handle.unref()

  nitroApp.hooks.hook('close', () => {
    clearInterval(handle)
    flush() // persist any buffered history on shutdown
  })
})
