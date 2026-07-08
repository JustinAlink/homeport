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
