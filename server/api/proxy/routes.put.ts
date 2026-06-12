import { resolveAdmin, parseRouteBody } from '../../utils/proxy-admin/resolve'

export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event)
  const id = String(body?.id || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Expected { id }' })
  try {
    const admin = resolveAdmin(body?.host)
    if (!admin.capabilities.update) throw Object.assign(new Error(`${admin.name} can't update routes`), { code: 400 })
    return { ok: true, route: await admin.updateRoute(id, parseRouteBody(body)) }
  } catch (e: any) {
    throw createError({ statusCode: e?.code || 502, statusMessage: e?.message || 'update failed' })
  }
})
