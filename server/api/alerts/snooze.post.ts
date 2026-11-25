import { readSilences, writeSilences } from '../../utils/silences'

const MAX_MS = 31 * 24 * 3600_000 // a snooze is for a while, not a way to switch alerts off for good (that is hub.noalert)

// Snooze one app's alerts ({ key, until, note }) or end the snooze ({ key, until: null }).
// The key is `<hostId>|<container name>`, so a snooze survives the app being recreated.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ key?: string; until?: number | null; note?: string }>(event)
  const key = String(body?.key || '')
  if (!/^[\w.-]{1,64}\|[\w.-]{1,128}$/.test(key)) throw createError({ statusCode: 400, statusMessage: 'invalid app key' })
  const now = Date.now()
  const s = readSilences(now)
  const snoozes = { ...s.snoozes }
  if (body?.until === null) delete snoozes[key]
  else {
    const until = Number(body?.until)
    if (!Number.isFinite(until) || until <= now || until - now > MAX_MS) throw createError({ statusCode: 400, statusMessage: 'until must be in the next 31 days' })
    snoozes[key] = { until, at: now, ...(body?.note ? { note: String(body.note).trim().slice(0, 120) } : {}) }
  }
  try {
    const next = writeSilences({ ...s, snoozes })
    return { snoozes: next.snoozes }
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `could not save: ${e?.message || e}` })
  }
})
