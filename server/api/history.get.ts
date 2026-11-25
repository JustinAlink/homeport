import { getConfig } from '../utils/config'
import { getHistory } from '../utils/history'
import { parseRangeHours } from '../utils/history-core'
import { seriesKeyFor } from '../utils/series-key'
import { demoHistory } from '../utils/demo'

// GET /api/history?id=<id>&range=<Nh|Nd>. id: a service id, "host", "host-system",
// or a container key "<hostId>|<container name>".
// → evenly-spaced CPU/mem series. Ranges run up to 30 days; the store picks the
// tier (1 min for a day, 15 min for a week, 1 h for a month). `res` says which,
// so a graph can say its points are averages. Auth-protected by the global middleware.
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const hours = parseRangeHours(q.range)
  const to = Date.now()
  const from = to - hours * 3600 * 1000

  const key = await seriesKeyFor(String(q.id || 'host'))
  // an id that names no container (gone, a systemd unit): an empty series, not an error
  if (!key) return { res: getConfig().historyResolution, t: [], cpu: [], mem: [] }
  if (getConfig().demo) return demoHistory(key, from, to)
  return getHistory(key, from, to)
})
