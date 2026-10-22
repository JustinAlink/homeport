// Which proxy the dashboard says it maps domains through. Auto-detect falls back
// to reading Traefik container labels when no proxy is configured, and that
// fallback always "exists", so every install used to claim "domains via
// Traefik": the no-proxy onboarding card and the settings hint never showed.
// A provider is only reported when it was configured or actually found routes.

export interface ProviderHostConfig {
  domainProvider?: string | null
  npmConfDir?: string | null
  caddyfilePath?: string | null
  nginxConfDir?: string | null
  traefikFilePath?: string | null
}

export function isProviderConfigured(host: ProviderHostConfig): boolean {
  return !!(host.domainProvider || host.npmConfDir || host.caddyfilePath || host.nginxConfDir || host.traefikFilePath)
}

export function reportedProviderName(name: string | null | undefined, host: ProviderHostConfig, routeCount: number): string | null {
  if (!name) return null
  return isProviderConfigured(host) || routeCount > 0 ? name : null
}
