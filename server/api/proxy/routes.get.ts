import { resolveAdmin } from '../../utils/proxy-admin/resolve'

export default defineEventHandler(async (event) => {
  try {
    const admin = resolveAdmin(String(getQuery(event).host || '') || undefined)
    return { provider: admin.name, capabilities: admin.capabilities, routes: await admin.listRoutes() }
  } catch (e: any) {
    throw createError({ statusCode: e?.code || 502, statusMessage: e?.message || 'failed' })
  }
})
