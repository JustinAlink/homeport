// Which container stands between a domain and its app, by where homeport read the
// domain. One list for the server (the domain check's fallback route) and the
// browser (can that container reach the app over a shared network?), so the two
// never disagree. Several proxies can run on one host (Traefik beside
// caddy-docker-proxy, a Pangolin tunnel beside either): picking the first proxy
// found for every domain checked a Traefik domain through Caddy and warned that
// Caddy couldn't reach an app only Newt needs to reach.

/** Reverse proxy images homeport recognises. */
export const PROXY_IMAGES = [
  'jc21/nginx-proxy-manager',
  'traefik',
  'caddy',
  'lucaslorentz/caddy-docker-proxy',
  'nginxproxy/nginx-proxy',
  'jwilder/nginx-proxy',
]

/** Per domain source (the provider names in server/utils/providers), the images that connect to the app. */
export const SOURCE_PROXY_IMAGES: Record<string, string[]> = {
  'Nginx Proxy Manager': ['jc21/nginx-proxy-manager'],
  Traefik: ['traefik'],
  'Traefik (file)': ['traefik'],
  'Traefik (API)': ['traefik'],
  Caddy: ['caddy', 'lucaslorentz/caddy-docker-proxy'],
  'caddy-docker-proxy': ['lucaslorentz/caddy-docker-proxy'],
  Pangolin: ['fosrl/newt', 'fosrl/pangolin-cli'],
}

/** Sources served through a tunnel: no local proxy answers for their domains over HTTP. */
export const TUNNEL_SOURCES = ['Pangolin']
