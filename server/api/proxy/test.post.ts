import { resolveAdmin } from '../../utils/proxy-admin/resolve'

// Test the proxy-admin connection for a host. Returns {ok,message} per provider.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ host?: string }>(event)
  try {
    const admin = resolveAdmin(body?.host)
    const result = await admin.test()
    return { provider: admin.name, ...result }
  } catch (e: any) {
    throw createError({ statusCode: e?.code || 502, statusMessage: e?.message || 'test failed' })
  }
})
