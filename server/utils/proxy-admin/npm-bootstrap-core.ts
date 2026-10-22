// Pure logic for auto-wiring a freshly-installed Nginx Proxy Manager to homeport.
// No fs/network — the orchestration in npm-bootstrap.ts supplies randomness and
// does the HTTP. Kept pure so the fiddly bits are unit-testable without a live NPM.

// jc21/nginx-proxy-manager ships with these defaults and forces a change on first login.
export const DEFAULT_NPM_IDENTITY = 'admin@example.com'
export const DEFAULT_NPM_SECRET = 'changeme'

/**
 * A strong admin password derived from random bytes. base64url alphabet
 * (A–Z a–z 0–9 - _) keeps it copy-paste safe; NPM requires ≥ 8 chars, we give ~24.
 * Guarantees at least one letter and one digit so any policy check passes.
 */
export function passwordFromBytes(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64url').replace(/[-_]/g, '')
  const body = b64.slice(0, 22) || 'homeportGenerated00'
  // Force variety deterministically (does not weaken it — appends, never trims below 8).
  const hasDigit = /[0-9]/.test(body)
  const hasAlpha = /[a-zA-Z]/.test(body)
  return `${body}${hasAlpha ? '' : 'a'}${hasDigit ? '' : '7'}`
}

/** Token from a `POST /api/tokens` response, or null. */
export function parseToken(data: unknown): string | null {
  const t = (data as { token?: unknown })?.token
  return typeof t === 'string' && t.length > 0 ? t : null
}

/**
 * Why a `POST /api/tokens` login gave no token, in words a person can act on.
 * NPM 2.13+ answers an account with two-factor authentication with HTTP 200 and
 * `{ requires_2fa, challenge_token }` instead of a token; homeport can't type the
 * code, so that case gets its own explanation (and the fix: a service user).
 */
export function npmLoginError(r: { ok: boolean; status: number; error?: string | null; data?: unknown }): string {
  if ((r.data as { requires_2fa?: unknown })?.requires_2fa) {
    return 'This NPM account has two-factor authentication, which a login through NPM\'s API cannot complete. Give homeport its own NPM user without it: in NPM, Users → Add User, permissions Proxy Hosts: Manage (and Certificates: View), then enter that user here. Your own account keeps 2FA.'
  }
  if (r.status === 401) return 'NPM rejected the email or password (401).'
  return `NPM login failed (${r.error || r.status})`
}

/** Body for `PUT /api/users/{id}/auth` — rotate the password. */
export function passwordChangeBody(current: string, next: string): string {
  return JSON.stringify({ type: 'password', current, secret: next })
}

/** Body for `POST /api/tokens` — login. */
export function tokenBody(identity: string, secret: string): string {
  return JSON.stringify({ identity, secret })
}

/** Normalise a user-supplied NPM base URL (default the in-network service name). */
export function npmBaseUrl(url: string | undefined): string {
  const u = (url || '').trim().replace(/\/+$/, '')
  return u || 'http://nginx-proxy-manager:81'
}

/** The settings patch that wires homeport's proxy-admin to the connected NPM. */
export function credsSettingsPatch(url: string, identity: string, secret: string) {
  return {
    npmApiUrl: npmBaseUrl(url),
    npmApiIdentity: identity,
    npmApiSecret: secret,
    domainProvider: 'npm' as const,
    allowProxyAdmin: true,
  }
}

export interface BootstrapResult {
  ok: boolean
  /** the NPM login homeport is now using */
  identity?: string
  /** the (generated) password — surfaced ONCE so the user can also log into NPM's own UI */
  secret?: string
  /** true when we rotated the default password (fresh install) vs used supplied creds */
  rotated?: boolean
  /** NPM already had its default password changed → ask the user for their creds */
  alreadyConfigured?: boolean
  /** NPM's API never came up in time */
  notReady?: boolean
  error?: string
}
