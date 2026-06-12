import { resolveAdmin, parseRouteBody } from '../../utils/proxy-admin/resolve'

export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event)
  try {
    const admin = resolveAdmin(body?.host)
    if (!admin.capabilities.create) throw Object.assign(new Error(`${admin.name} can't create routes`), { code: 400 })
    return { ok: true, route: await admin.createRoute(parseRouteBody(body)) }
  } catch (e: any) {
    throw createError({ statusCode: e?.code || 502, statusMessage: e?.message || 'create failed' })
  }
})
