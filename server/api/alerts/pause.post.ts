import { readSilences, writeSilences } from '../../utils/silences'

const MAX_MS = 31 * 24 * 3600_000

// Pause every alert until a time ({ until, note }) or resume ({ until: null }).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ until?: number | null; note?: string }>(event)
  const now = Date.now()
  const s = readSilences(now)
  let next = s
  if (body?.until === null) next = { snoozes: s.snoozes, pausedUntil: 0 }
  else {
    const until = Number(body?.until)
    if (!Number.isFinite(until) || until <= now || until - now > MAX_MS) throw createError({ statusCode: 400, statusMessage: 'until must be in the next 31 days' })
    next = { ...s, pausedUntil: until, ...(body?.note ? { pauseNote: String(body.note).trim().slice(0, 120) } : { pauseNote: undefined }) }
  }
  try {
    const saved = writeSilences(next)
    return { pausedUntil: saved.pausedUntil, pauseNote: saved.pauseNote ?? null }
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `could not save: ${e?.message || e}` })
  }
})
