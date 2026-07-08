import { randomBytes } from 'node:crypto'
import { httpJson } from '../http'
import { log } from '../log'
import {
  DEFAULT_NPM_IDENTITY,
  DEFAULT_NPM_SECRET,
  passwordFromBytes,
  parseToken,
  passwordChangeBody,
  tokenBody,
  npmBaseUrl,
  type BootstrapResult,
} from './npm-bootstrap-core'

// Auto-wire a homeport-installed Nginx Proxy Manager: wait for its API, log in
// with the shipped defaults, rotate the default password to a generated one, and
// hand the new credentials back so homeport can manage it (and so the user can
// still sign into NPM's own UI). Falls back cleanly when NPM is already set up.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function login(base: string, identity: string, secret: string) {
  return httpJson<{ token: string }>(`${base}/api/tokens`, {
    method: 'POST',
    body: tokenBody(identity, secret),
    timeoutMs: 8000,
  })
}

/** Connect to an NPM the user already set up, using the credentials they gave us. */
export async function connectNpm(url: string, identity: string, secret: string): Promise<BootstrapResult> {
  const base = npmBaseUrl(url)
  const r = await login(base, identity, secret)
  if (r.ok && parseToken(r.data)) return { ok: true, identity, secret, rotated: false }
  return { ok: false, error: `NPM login failed (${r.error || r.status})` }
}

/** Auto-bootstrap a fresh NPM (default admin@example.com / changeme). */
export async function bootstrapNpm(
  url: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<BootstrapResult> {
  const base = npmBaseUrl(url)
  const attempts = opts.attempts ?? 8
  const delayMs = opts.delayMs ?? 3000

  // NPM initialises its DB on first boot — poll the default login until it answers.
  let token: string | null = null
  for (let i = 0; i < attempts; i++) {
    const r = await login(base, DEFAULT_NPM_IDENTITY, DEFAULT_NPM_SECRET)
    if (r.ok) {
      token = parseToken(r.data)
      if (token) break
    }
    if (r.status === 401) return { ok: false, alreadyConfigured: true } // default password already changed
    if (i < attempts - 1) await sleep(delayMs)
  }
  if (!token) return { ok: false, notReady: true }

  // Rotate the well-known default password to a generated strong one.
  const newSecret = passwordFromBytes(randomBytes(18))
  const changed = await httpJson(`${base}/api/users/1/auth`, {
    method: 'PUT',
    body: passwordChangeBody(DEFAULT_NPM_SECRET, newSecret),
    headers: { authorization: `Bearer ${token}` },
    timeoutMs: 8000,
  })
  if (!changed.ok) {
    log.warn('npm-bootstrap', `logged into NPM but the password change failed (${changed.error || changed.status})`)
    return { ok: false, error: 'Connected, but changing the default password failed. Change it in NPM, then use “I already have NPM”.' }
  }

  // Verify the new credentials work before we persist them.
  const verify = await login(base, DEFAULT_NPM_IDENTITY, newSecret)
  if (!verify.ok || !parseToken(verify.data)) {
    return { ok: false, error: 'The password was changed but the new login did not verify — check NPM.' }
  }

  log.info('npm-bootstrap', 'auto-configured a fresh Nginx Proxy Manager and rotated its default password')
  return { ok: true, identity: DEFAULT_NPM_IDENTITY, secret: newSecret, rotated: true }
}
