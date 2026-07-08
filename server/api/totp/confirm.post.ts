import { confirmEnroll } from '../../utils/totp'

// Finish 2FA enrollment: the secret the client was just handed, plus a code
// proving it was scanned correctly. Persists + returns recovery codes ONCE.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ secret?: string; code?: string }>(event)
  if (!body?.secret || !body?.code) {
    throw createError({ statusCode: 400, statusMessage: 'Missing secret or code.' })
  }
  const result = confirmEnroll(body.secret, body.code, Date.now())
  if (!result) {
    throw createError({ statusCode: 400, statusMessage: 'Incorrect code — check your authenticator app and try again.' })
  }
  return { ok: true, recoveryCodes: result.codes }
})
