import { createHmac, timingSafeEqual } from 'node:crypto'
import { safeReturnTo } from '../../shared/utils/return-to.ts'

export { safeReturnTo }

// Pure pieces of OIDC sign-in, unit-tested: reading group claims in the shapes the
// common providers use, mapping them to homeport's two roles, the signed state
// cookie that carries PKCE/state/nonce across the redirect, and the URL rules.
// The protocol itself (discovery, token exchange, ID token validation) is done by
// openid-client: hand-rolled JWT checks are where self-made SSO usually breaks.

export type SsoRole = 'admin' | 'viewer'

/** A claim by dotted path: "groups", "resource_access.homeport.roles". */
export function claimAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.').filter(Boolean)) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/**
 * Group names from a claim value, normalised: an array (most providers), a
 * comma or newline separated string, or an object whose keys are the roles
 * (Zitadel). Never split on spaces: group names have them ("authentik Admins"),
 * and "Homelab Admins" read as "homelab" + "admins" would let every member of
 * "Homelab" match an admin group. Keycloak's full group paths ("/admins") lose
 * their leading slash; matching is case-blind.
 */
export function groupsFrom(value: unknown): string[] {
  let raw: string[] = []
  if (Array.isArray(value)) raw = value.filter((v) => typeof v === 'string') as string[]
  else if (typeof value === 'string') raw = value.split(/[,\n]+/)
  else if (value && typeof value === 'object') raw = Object.keys(value as object)
  return [...new Set(raw.map((g) => g.trim().replace(/^\/+/, '').replace(/\s+/g, ' ').toLowerCase()).filter(Boolean))]
}

/** A settings list ("admins, homelab\nops") as normalised group names. */
export const parseGroupList = (text: string | string[] | undefined): string[] => groupsFrom(Array.isArray(text) ? text : String(text ?? ''))

/**
 * The role a sign-in gets. Admin groups win over viewer groups; a user in neither
 * is refused (fail closed: being able to sign in at the provider is not the same
 * as being allowed into homeport).
 */
export function roleFor(groups: string[], adminGroups: string[], viewerGroups: string[]): SsoRole | null {
  const has = (list: string[]) => list.some((g) => groups.includes(g))
  if (adminGroups.length && has(adminGroups)) return 'admin'
  if (viewerGroups.length && has(viewerGroups)) return 'viewer'
  return null
}

/** A homeport username for an SSO viewer, from the provider's claims (3-32 of [a-z0-9_.-]). */
export function usernameFromClaims(c: { preferred_username?: unknown; email?: unknown; name?: unknown; sub?: unknown }): string {
  const pick = [c.preferred_username, c.email, c.name, c.sub].find((v) => typeof v === 'string' && v.trim()) as string | undefined
  let u = (pick ?? 'sso-user')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 28)
  if (u.length < 3) u = `sso-${u || 'user'}`
  // "admin" is the primary account's name: an SSO user never takes it over
  if (u === 'admin') u = 'admin-sso'
  return u
}

/** The first of base, base-2, base-3... that isn't taken. */
export function uniqueUsername(base: string, taken: (u: string) => boolean): string {
  if (!taken(base)) return base
  for (let n = 2; n < 1000; n++) {
    const c = `${base.slice(0, 28)}-${n}`
    if (!taken(c)) return c
  }
  return `${base.slice(0, 20)}-${Date.now().toString(36)}`
}

/**
 * The public origin homeport is reached at (scheme, host, port; no path), or null.
 * The redirect URI is built from this, never from request headers, which a client
 * or a misconfigured proxy can set.
 */
export function normalizePublicUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u.trim()) return null
  try {
    const url = new URL(u.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

export const redirectUriFor = (publicUrl: string) => `${publicUrl}/api/auth/oidc/callback`

export interface OidcState {
  /** PKCE code verifier */
  v: string
  /** state */
  s: string
  /** nonce */
  n: string
  /** where to go afterwards */
  r: string
  iat: number
}

export const STATE_MAX_AGE_MS = 10 * 60_000

const b64 = (s: string) => Buffer.from(s).toString('base64url')
const sign = (payload: string, key: string) => createHmac('sha256', key).update(`oidc-state.${payload}`).digest('base64url')

/** The signed cookie value carrying PKCE, state and nonce across the provider redirect. */
export function packState(st: OidcState, key: string): string {
  const payload = b64(JSON.stringify(st))
  return `${payload}.${sign(payload, key)}`
}

/** The state back, or null when it is missing, tampered with or older than ten minutes. */
export function unpackState(value: string | undefined, key: string, now: number): OidcState | null {
  if (!value) return null
  const [payload, sig] = value.split('.')
  if (!payload || !sig) return null
  const expected = sign(payload, key)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const st = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OidcState
    if (typeof st.iat !== 'number' || now - st.iat > STATE_MAX_AGE_MS || now < st.iat - 60_000) return null
    if (![st.v, st.s, st.n].every((x) => typeof x === 'string' && x.length >= 16)) return null
    return { ...st, r: safeReturnTo(st.r) }
  } catch {
    return null
  }
}

/** Why a sign-in failed, as a code the login page turns into a sentence. */
export type SsoError = 'state' | 'denied' | 'provider' | 'exchange' | 'config' | 'off'
export const SSO_ERROR_TEXT: Record<SsoError, string> = {
  state: 'The sign-in took too long or was started in another browser. Please try again.',
  denied: 'Your account signed in, but it is not in a group allowed into homeport. Ask the admin to add you to one.',
  provider: 'The identity provider refused or cancelled the sign-in.',
  exchange: 'homeport could not complete the sign-in with the identity provider. Check the client secret and the redirect URI there.',
  config: 'Single sign-on is not set up completely. Use your password, or ask the admin.',
  off: 'Single sign-on is turned off.',
}
