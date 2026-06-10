// Central runtime config — read from process.env at request time so a single
// prebuilt image is fully configurable when the container starts.

export interface HomeportConfig {
  /** Password for the single admin login. Empty = login disabled (NOT recommended). */
  adminPassword: string
  /** Secret used to sign the session cookie. */
  sessionSecret: string
  /** Where Docker lives: ssh://user@host, tcp://host:port, or empty for the unix socket. */
  dockerHost: string
  /** Path to the Docker unix socket (when dockerHost is empty). */
  dockerSocket: string
  /** Private key path for ssh:// DOCKER_HOST (falls back to the SSH agent if unset). */
  dockerSshKey: string
  /** Optional passphrase for the SSH key. */
  dockerSshPassphrase: string
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
    dockerSshKey: process.env.DOCKER_SSH_KEY ?? '',
    dockerSshPassphrase: process.env.DOCKER_SSH_KEY_PASSPHRASE ?? '',
    domainProvider: (process.env.DOMAIN_PROVIDER || '').toLowerCase(),
    npmConfDir: process.env.NPM_CONF_DIR ?? '',
    caddyfilePath: process.env.CADDYFILE_PATH ?? '',
    demo: process.env.HOMEPORT_DEMO === 'true',
    allowControl: process.env.HOMEPORT_ALLOW_CONTROL === 'true',
  }
}
