import { resolveAdmin } from '../../utils/proxy-admin/resolve'

export default defineEventHandler(async (event) => {
  try {
    const admin = resolveAdmin(String(getQuery(event).host || '') || undefined)
    // what homeport's own proxy login may do (NPM): shown on the Domains page, and
    // edit buttons it couldn't use are hidden. Unknown access (older NPM, a hiccup)
    // falls back to the provider's static capabilities.
    const access = admin.access ? await admin.access().catch(() => null) : null
    const capabilities = access && !access.canManage ? { create: false, update: false, delete: false } : admin.capabilities
    return { provider: admin.name, capabilities, access, routes: await admin.listRoutes() }
  } catch (e: any) {
    throw createError({ statusCode: e?.code || 502, statusMessage: e?.message || 'failed' })
  }
})
