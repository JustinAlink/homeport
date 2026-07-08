import { deleteUser } from '../utils/users'

// Delete a viewer account by id. Deleting it invalidates any of its sessions
// immediately — the session's uid stops resolving on the next request.
export default defineEventHandler((event) => {
  const id = String(getQuery(event).id || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })
  if (!deleteUser(id)) throw createError({ statusCode: 404, statusMessage: 'no such account' })
  return { ok: true }
})
