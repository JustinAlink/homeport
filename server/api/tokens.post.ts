import { createToken } from '../utils/api-tokens'

// Create an API token. Returns the plaintext ONCE — it's only stored hashed.
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : ''
  const scope = body?.scope === 'full' ? 'full' : 'read'
  const { token, meta } = createToken(name, scope)
  return { token, meta }
})
