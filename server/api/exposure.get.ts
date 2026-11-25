import { getConfig } from '../utils/config'
import { getExposure } from '../utils/exposure'
import { demoExposure } from '../utils/demo'

// GET /api/exposure[?probe=1][&id=<serviceId>]: how each running container can be
// reached. Without probe it answers at once from ports and routes; with probe it
// also asks every domain what an anonymous visitor gets (login, HTTPS redirect).
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const probe = String(q.probe || '') === '1'
  const id = q.id ? String(q.id) : undefined
  if (getConfig().demo) return demoExposure({ probe, id })
  return getExposure({ probe, id })
})
