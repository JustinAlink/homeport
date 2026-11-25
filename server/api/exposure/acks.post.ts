import { setAck } from '../../utils/exposure'

// Accept an exposure finding as intended ({ key, code, note }) or take that back
// ({ key, code, note: null }). Admin-only: read-only callers never reach a POST.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ key?: string; code?: string; note?: string | null }>(event)
  if (!body?.key || !body?.code || (body.note !== null && typeof body.note !== 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { key, code, note }' })
  }
  try {
    return { acks: setAck(body.key, body.code, body.note) }
  } catch (e: any) {
    throw createError({ statusCode: e?.statusCode || 500, statusMessage: e?.message || 'could not save' })
  }
})
