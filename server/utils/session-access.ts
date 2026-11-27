import type { H3Event } from 'h3'
import { SESSION_COOKIE, decodeSessionToken, type SessionPayload } from './session'
import { getUser } from './users'
import { sessionAccess, type AccessRole } from './users-core'
import { ssoMissing } from './oidc'

// The one place a session's role is decided (sessionAccess in users-core.ts). The
// middleware, the terminal's WebSocket (which bypasses it), and the endpoints that
// treat read-only accounts differently all ask here, so a revoked or demoted
// account is refused everywhere the same way.

export function accessOfSession(session: SessionPayload | null): AccessRole | null {
  const user = session?.uid ? getUser(session.uid) : null
  return sessionAccess(session, user, !ssoMissing())
}

export const accessOf = (event: H3Event): AccessRole | null => accessOfSession(decodeSessionToken(getCookie(event, SESSION_COOKIE)))
