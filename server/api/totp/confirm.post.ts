import { confirmEnroll, isTotpEnabled } from '../../utils/totp'

// Finish 2FA enrollment: the secret the client was just handed, plus a code
// proving it was scanned correctly. Persists + returns recovery codes ONCE.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ secret?: string; code?: string }>(event)
  if (!body?.secret || !body?.code) {
    throw createError({ statusCode: 400, statusMessage: 'Missing secret or code.' })
  }
  // The client supplies the secret, so without this a hijacked session could swap
  // in its own secret and fresh recovery codes over working 2FA, skipping the
  // password re-check that disable and regenerate require, and lock the owner out.
  if (isTotpEnabled()) throw createError({ statusCode: 409, statusMessage: '2FA is already on. Turn it off first to set it up again.' })
  const result = confirmEnroll(body.secret, body.code, Date.now())
  if (!result) {
    throw createError({ statusCode: 400, statusMessage: 'Incorrect code — check your authenticator app and try again.' })
  }
  return { ok: true, recoveryCodes: result.codes }
})
