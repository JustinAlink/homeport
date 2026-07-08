import { revokeToken } from '../utils/api-tokens'

// Revoke an API token by id.
export default defineEventHandler((event) => {
  const id = String(getQuery(event).id || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })
  if (!revokeToken(id)) throw createError({ statusCode: 404, statusMessage: 'no such token' })
  return { ok: true }
})
