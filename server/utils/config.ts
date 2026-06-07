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
  /** Directory of Nginx Proxy Manager generated proxy-host confs. Empty = no domain provider. */
  npmConfDir: string
  /** Serve a synthetic fleet (no Docker needed) — for trying homeport / screenshots. */
  demo: boolean
}

export function getConfig(): HomeportConfig {
  return {
    adminPassword: process.env.HOMEPORT_ADMIN_PASSWORD ?? '',
    sessionSecret: process.env.HOMEPORT_SESSION_SECRET || 'insecure-dev-secret-change-me',
    dockerHost: process.env.DOCKER_HOST ?? '',
    dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    npmConfDir: process.env.NPM_CONF_DIR ?? '',
    demo: process.env.HOMEPORT_DEMO === 'true',
  }
}
