// Central runtime config — read from process.env at request time so a single
// prebuilt image is fully configurable when the container starts.

export interface HomeportConfig {
  /** Password for the single admin login. Empty = login disabled (NOT recommended). */
  adminPassword: string
  /** Secret used to sign the session cookie. */
  sessionSecret: string
  /** tcp://host:port for a docker-socket-proxy. Empty = use the unix socket. */
  dockerHost: string
  /** Path to the Docker unix socket (when dockerHost is empty). */
  dockerSocket: string
  /** Explicit reverse-proxy provider: 'npm' | 'traefik' | 'caddy'. Empty = auto-detect. */
  domainProvider: string
  /** Directory of Nginx Proxy Manager generated proxy-host confs. */
  npmConfDir: string
  /** Path to a Caddyfile (for the caddy provider). */
  caddyfilePath: string
  /** Serve a synthetic fleet (no Docker needed) — for trying homeport / screenshots. */
  demo: boolean
  /** Allow start/stop controls. Off by default — homeport is read-only unless opted in. */
  allowControl: boolean
}

export function getConfig(): HomeportConfig {
  return {
    adminPassword: process.env.HOMEPORT_ADMIN_PASSWORD ?? '',
    sessionSecret: process.env.HOMEPORT_SESSION_SECRET || 'insecure-dev-secret-change-me',
    dockerHost: process.env.DOCKER_HOST ?? '',
    dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    domainProvider: (process.env.DOMAIN_PROVIDER || '').toLowerCase(),
    npmConfDir: process.env.NPM_CONF_DIR ?? '',
    caddyfilePath: process.env.CADDYFILE_PATH ?? '',
    demo: process.env.HOMEPORT_DEMO === 'true',
    allowControl: process.env.HOMEPORT_ALLOW_CONTROL === 'true',
  }
}
