import { resolveAdmin } from '../../utils/proxy-admin/resolve'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const id = String(q.id || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Expected ?id' })
  try {
    const admin = resolveAdmin(String(q.host || '') || undefined)
    if (!admin.capabilities.delete) throw Object.assign(new Error(`${admin.name} can't delete routes`), { code: 400 })
    await admin.deleteRoute(id)
    return { ok: true }
  } catch (e: any) {
    throw createError({ statusCode: e?.code || 502, statusMessage: e?.message || 'delete failed' })
  }
})
