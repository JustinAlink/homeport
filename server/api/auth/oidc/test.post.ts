import { getConfig } from '../../../utils/config'
import { oidcConfiguration, redirectUri } from '../../../utils/oidc'
import { effectiveScopes } from '../../../utils/oidc-core'

// Admin "Test" button: run discovery with what is on screen (or saved) and report
// what the provider offers, so a typo in the issuer shows before anyone signs in.
export default defineEventHandler(async (event) => {
  const body: { issuer?: string; clientId?: string; clientSecret?: string; scopes?: string } = (await readBody(event).catch(() => null)) ?? {}
  const cfg = getConfig()
  const issuer = (body?.issuer || cfg.oidcIssuer || '').trim()
  const clientId = (body?.clientId || cfg.oidcClientId || '').trim()
  const clientSecret = body?.clientSecret || cfg.oidcClientSecret
  if (!issuer || !clientId) return { ok: false, message: 'Fill in the issuer URL and the client ID first.' }
  try {
    const conf = await oidcConfiguration({ oidcIssuer: issuer, oidcClientId: clientId, oidcClientSecret: clientSecret || 'unset' }, true)
    const m = conf.serverMetadata()
    const { dropped } = effectiveScopes(body?.scopes ?? cfg.oidcScopes, m.scopes_supported)
    const notes = [
      m.userinfo_endpoint ? '' : 'no userinfo endpoint: groups must be in the ID token',
      dropped.length ? `it doesn't offer the scope${dropped.length > 1 ? 's' : ''} ${dropped.join(', ')}, so homeport leaves ${dropped.length > 1 ? 'them' : 'it'} out; the groups have to come with another scope or a claim mapper` : '',
    ].filter(Boolean)
    return {
      ok: true,
      message: `Found ${m.issuer}${notes.length ? `: ${notes.join('; ')}` : ''}.`,
      droppedScopes: dropped,
      issuer: m.issuer,
      pkce: m.supportsPKCE(),
      redirectUri: cfg.publicUrl ? redirectUri(cfg) : null,
      scopes: m.scopes_supported ?? null,
    }
  } catch (e: any) {
    return { ok: false, message: `Discovery failed: ${e?.message || e}. Check the issuer URL, and that homeport's container can reach it.` }
  }
})
