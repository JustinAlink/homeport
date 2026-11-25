import { getConfig } from '../utils/config'
import { getLatestSnapshot } from '../utils/collector'
import { healthOf } from '../utils/health-core'

// Health for the image's HEALTHCHECK and for outside monitors (Uptime Kuma etc.).
// It lives outside /api/, so the auth middleware never sees it and a monitor needs
// no token. Being public, it says only the verdict: no version, host names or counts.
// The case it exists for: a homeport that lost its Docker transport keeps serving
// pages but sees nothing (the v2.27.2 socket-proxy incident). Before this, docker ps
// still called that container healthy.
export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')
  const cfg = getConfig()
  // Demo mode has no collector and no Docker; serving pages is all it does.
  if (cfg.demo) return { status: 'ok' }
  const bootAt = Date.now() - process.uptime() * 1000
  const v = healthOf(getLatestSnapshot(), Date.now(), Math.max(10, cfg.collectorInterval) * 1000, bootAt)
  if (!v.ok) setResponseStatus(event, 503)
  return { status: v.status }
})
