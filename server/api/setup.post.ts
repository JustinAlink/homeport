import { createSessionToken, SESSION_COOKIE } from '../utils/session'
import { authMode, setPassword } from '../utils/auth'
import { judgeSetup } from '../utils/setup-core'
import { setupCode, retireSetupCode } from '../utils/setup'
import { lockRemaining, recordFailure, type LoginRate } from '../utils/auth-core'
import { log } from '../utils/log'

// Public, but only effective during first-run setup (no password configured
// yet), and only with the one-time setup code from homeport's log: without it,
// anyone who found a fresh install first could claim the admin account, and
// with it the Docker host. The rules live in setup-core `judgeSetup`.

// Wrong codes per client IP. 60 bits of code already makes guessing hopeless,
// so this is about not letting one client hammer the endpoint (and the log).
// No global ceiling, unlike login: it would only let a stranger lock the owner
// out of their own setup.
const attempts = new Map<string, LoginRate>()
const MAP_CAP = 10_000

const trustProxy = process.env.HOMEPORT_TRUSTED_PROXY === 'true' || process.env.HOMEPORT_TRUSTED_PROXY === '1'

export default defineEventHandler(async (event) => {
  const ip = (trustProxy ? getRequestIP(event, { xForwardedFor: true }) : getRequestIP(event)) || 'unknown'
  const now = Date.now()

  const wait = lockRemaining(attempts.get(ip), now)
  if (wait > 0) {
    throw createError({ statusCode: 429, statusMessage: `Too many wrong setup codes. Try again in ${Math.ceil(wait / 1000)}s.`, data: { field: 'code' } })
  }

  const body = await readBody<{ password?: string; code?: string; skip?: boolean }>(event)
  const mode = authMode()
  const verdict = judgeSetup(mode, body, mode === 'setup' ? setupCode() : '')
  if (!verdict.ok) {
    if (verdict.failedGuess) {
      if (attempts.size >= MAP_CAP) attempts.clear() // crude but bounded
      attempts.set(ip, recordFailure(attempts.get(ip), now))
      // Worth the operator's attention: someone else may have found the instance.
      log.warn('setup', `wrong setup code from ${ip}`)
      await new Promise((r) => setTimeout(r, 300)) // flat cost per wrong guess
    }
    throw createError({ statusCode: verdict.status, statusMessage: verdict.message, data: { field: verdict.field } })
  }

  try {
    setPassword(body?.password ?? '')
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message || 'could not set password' })
  }
  attempts.delete(ip)
  retireSetupCode()
  log.info('setup', 'admin password created; first-run setup is complete')

  const proto = getHeader(event, 'x-forwarded-proto') || 'http'
  setCookie(event, SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return { ok: true }
})
