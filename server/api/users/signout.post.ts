import { signOutUser } from '../../utils/users'

// End every session of one account (viewer or SSO), on all devices, without
// deleting it. Admin-only like the rest of /api/users: API tokens are refused by
// the middleware and read-only accounts cannot POST.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ id?: unknown }>(event)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })
  if (!signOutUser(id)) throw createError({ statusCode: 404, statusMessage: 'no such account' })
  return { ok: true }
})
