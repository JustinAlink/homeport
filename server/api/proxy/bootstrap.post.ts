import { getConfig } from '../../utils/config'
import { settingsWritable, writeSettings } from '../../utils/settings'
import { bootstrapNpm, connectNpm } from '../../utils/proxy-admin/npm-bootstrap'
import { credsSettingsPatch, npmBaseUrl, DEFAULT_NPM_IDENTITY } from '../../utils/proxy-admin/npm-bootstrap-core'
import { log } from '../../utils/log'

// Connect homeport to a Nginx Proxy Manager and enable proxy management in one step.
//  - no identity/secret  → auto-bootstrap a freshly-installed NPM (rotate its default password)
//  - identity + secret   → connect to an NPM the user already configured
// On success it persists the credentials and flips on proxy-admin (+ provider=npm).
// Auth-gated like all /api/*; writes settings, so the data volume must be writable.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const body = await readBody<{ url?: string; identity?: string; secret?: string }>(event)
  const url = npmBaseUrl(body?.url)

  if (cfg.demo) {
    // Pretend: show the flow without touching anything.
    return { ok: true, rotated: !body?.identity, identity: body?.identity || DEFAULT_NPM_IDENTITY, secret: body?.identity ? undefined : 'demo-Generated-Passw0rd', demo: true }
  }
  if (!settingsWritable()) {
    throw createError({ statusCode: 409, statusMessage: 'Settings storage is not writable — mount a writable HOMEPORT_DATA_DIR volume.' })
  }

  const result =
    body?.identity && body?.secret ? await connectNpm(url, body.identity, body.secret) : await bootstrapNpm(url)

  if (!result.ok) {
    // These are expected states, not server errors — the UI branches on them.
    return {
      ok: false,
      alreadyConfigured: !!result.alreadyConfigured,
      notReady: !!result.notReady,
      error: result.error || (result.alreadyConfigured ? 'NPM is already set up — enter its credentials.' : result.notReady ? "NPM isn't reachable yet — give it a moment and retry." : 'Could not connect to NPM.'),
    }
  }

  try {
    writeSettings(credsSettingsPatch(url, result.identity!, result.secret!))
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `Connected to NPM but could not save the credentials: ${e?.message || e}` })
  }
  log.info('npm-bootstrap', `proxy management connected to NPM at ${url} (${result.rotated ? 'auto-configured' : 'existing creds'})`)

  // Return the generated password ONCE (only when we created it) so the user can
  // also sign into NPM's own UI. Existing-cred connects never echo the secret back.
  return { ok: true, rotated: !!result.rotated, identity: result.identity, secret: result.rotated ? result.secret : undefined }
})
