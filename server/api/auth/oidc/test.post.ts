import { getConfig } from '../../../utils/config'
import { oidcConfiguration, redirectUri } from '../../../utils/oidc'

// Admin "Test" button: run discovery with what is on screen (or saved) and report
// what the provider offers, so a typo in the issuer shows before anyone signs in.
export default defineEventHandler(async (event) => {
  const body: { issuer?: string; clientId?: string; clientSecret?: string } = (await readBody(event).catch(() => null)) ?? {}
  const cfg = getConfig()
  const issuer = (body?.issuer || cfg.oidcIssuer || '').trim()
  const clientId = (body?.clientId || cfg.oidcClientId || '').trim()
  const clientSecret = body?.clientSecret || cfg.oidcClientSecret
  if (!issuer || !clientId) return { ok: false, message: 'Fill in the issuer URL and the client ID first.' }
  try {
    const conf = await oidcConfiguration({ oidcIssuer: issuer, oidcClientId: clientId, oidcClientSecret: clientSecret || 'unset' }, true)
    const m = conf.serverMetadata()
    return {
      ok: true,
      message: `Found ${m.issuer}${m.userinfo_endpoint ? '' : ' (no userinfo endpoint: groups must be in the ID token)'}.`,
      issuer: m.issuer,
      pkce: m.supportsPKCE(),
      redirectUri: cfg.publicUrl ? redirectUri(cfg) : null,
      scopes: m.scopes_supported ?? null,
    }
  } catch (e: any) {
    return { ok: false, message: `Discovery failed: ${e?.message || e}. Check the issuer URL, and that homeport's container can reach it.` }
  }
})
