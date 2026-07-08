import { createUser } from '../utils/users'

// Create a viewer account. The admin sets the password directly (unlike API
// tokens, nothing is generated or shown once).
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const username = typeof body?.username === 'string' ? body.username : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  try {
    return createUser(username, password)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'Could not create account' })
  }
})
