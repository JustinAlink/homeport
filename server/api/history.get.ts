import { getConfig } from '../utils/config'
import { getHistory } from '../utils/history'
import { demoHistory } from '../utils/demo'

// GET /api/history?id=<serviceId|host>&range=<Nh> → evenly-spaced CPU/mem series.
// Auth-protected by the global middleware. id "host" = fleet aggregate.
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const id = String(q.id || 'host')
  const m = String(q.range || '6h').match(/^(\d+)h$/)
  const hours = m ? Math.min(168, Math.max(1, Number(m[1]))) : 6
  const to = Date.now()
  const from = to - hours * 3600 * 1000

  const cfg = getConfig()
  if (cfg.demo) return demoHistory(id, from, to, cfg.historyResolution)
  return getHistory(id, from, to)
})
