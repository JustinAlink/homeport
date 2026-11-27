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

/**
 * The scopes to ask for. homeport's own defaults (profile, email, groups) are
 * sent only when the provider lists them: Keycloak rejects the whole sign-in over
 * one scope it doesn't know (invalid_scope), and "groups" is a scope at Authelia
 * and Pocket ID but not at Keycloak, Authentik or Zitadel. Any other scope was
 * typed in on purpose and is sent as is: Zitadel's own urn:zitadel:iam:* scopes,
 * for one, never appear in its discovery. openid is always first. A provider that
 * publishes no scopes_supported list gets everything as configured.
 */
const DEFAULT_SCOPES = ['profile', 'email', 'groups']

export function effectiveScopes(configured: string, supported: unknown): { scope: string; dropped: string[]; unlisted: string[] } {
  const want = [...new Set(['openid', ...String(configured || '').split(/\s+/).filter(Boolean)])]
  if (!Array.isArray(supported) || !supported.length) return { scope: want.join(' '), dropped: [], unlisted: [] }
  const offered = new Set(supported.filter((x): x is string => typeof x === 'string'))
  const dropped = want.filter((s) => DEFAULT_SCOPES.includes(s) && !offered.has(s))
  const keep = want.filter((s) => !dropped.includes(s))
  const unlisted = keep.filter((s) => s !== 'openid' && !offered.has(s))
  return { scope: keep.join(' '), dropped, unlisted }
}

/**
 * How homeport sends its client secret to the token endpoint. HTTP Basic is the
 * standard's default and what Authelia enforces unless told otherwise (sending it
 * in the body failed every Authelia sign-in with invalid_client); the body is used
 * only for a provider that lists it and not Basic.
 */
export function pickClientAuth(methods: unknown): 'client_secret_basic' | 'client_secret_post' {
  if (!Array.isArray(methods) || !methods.length || methods.includes('client_secret_basic')) return 'client_secret_basic'
  return methods.includes('client_secret_post') ? 'client_secret_post' : 'client_secret_basic'
}

type ErrLike = { error?: unknown; error_description?: unknown; message?: unknown; code?: unknown; status?: unknown; alg?: unknown; cause?: unknown }

/** The error and its causes, outermost first. openid-client wraps the real reason ("unsupported JWS algorithm", {alg}) in a bland "unsupported operation". */
function chainOf(e: unknown): ErrLike[] {
  const out: ErrLike[] = []
  let cur: unknown = e
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
    out.push(cur as ErrLike)
    cur = (cur as ErrLike).cause
  }
  return out
}

/** An openid-client error as one log line, with the provider's own code and description and the underlying cause. */
export function describeOidcError(e: unknown): string {
  if (!e || typeof e !== 'object') return String(e)
  const parts: string[] = []
  for (const x of chainOf(e)) {
    if (typeof x.error === 'string') parts.push(`${x.error}${typeof x.error_description === 'string' && x.error_description ? `: ${x.error_description}` : ''}`)
    if (typeof x.message === 'string' && x.message) parts.push(x.message)
    if (typeof x.alg === 'string') parts.push(`alg ${x.alg}`)
    if (typeof x.code === 'string') parts.push(x.code)
    if (typeof x.status === 'number') parts.push(`HTTP ${x.status}`)
  }
  return [...new Set(parts)].join(' · ')
}

/**
 * Which failure this is, for the login page: a refused client, an ID token signed
 * with an algorithm homeport refuses (HS256: the client secret), an ID token whose
 * signature doesn't match the provider's published keys, or something else.
 */
export function oidcFailureKind(e: unknown): 'client' | 'algorithm' | 'signature' | null {
  const chain = chainOf(e)
  if (chain.some((x) => x.error === 'invalid_client')) return 'client'
  if (chain.some((x) => typeof x.alg === 'string' || (typeof x.message === 'string' && /JWS algorithm/i.test(x.message)))) return 'algorithm'
  if (chain.some((x) => typeof x.message === 'string' && /signature/i.test(x.message))) return 'signature'
  return null
}

/** Why a sign-in failed, as a code the login page turns into a sentence. */
export type SsoError = 'state' | 'denied' | 'provider' | 'scope' | 'client' | 'algorithm' | 'signature' | 'exchange' | 'config' | 'off'
export const SSO_ERROR_TEXT: Record<SsoError, string> = {
  state: 'The sign-in took too long or was started in another browser. Please try again.',
  denied: 'Your account signed in, but it is not in a group allowed into homeport. Ask the admin to add you to one.',
  provider: 'The identity provider refused or cancelled the sign-in.',
  scope: 'The identity provider refused the scopes homeport asked for. The admin can check Scopes under Single sign-on.',
  client: "The identity provider did not accept homeport's client ID or secret. The admin can check them at both ends.",
  algorithm: 'The identity provider signed the sign-in in a way homeport does not accept (with the client secret, HS256). The admin can give it a signing key.',
  signature: "The sign-in could not be verified: its signature doesn't match the identity provider's published keys. The admin can check the provider's signing keys.",
  exchange: 'homeport could not complete the sign-in with the identity provider. Check the client secret and the redirect URI there.',
  config: 'Single sign-on is not set up completely. Use your password, or ask the admin.',
  off: 'Single sign-on is turned off.',
}
