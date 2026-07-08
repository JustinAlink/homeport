// Curated built-in app catalog (native format — parsed through
// parseNativeCatalog like any other source, so it obeys the same rules).
// Kept deliberately small and mainstream; community Portainer template URLs
// can be added in settings for thousands more.
//
// Conventions: named volumes (portable), `{{PORT}}`-style tokens for
// everything the install form should ask, icons are dashboard-icons slugs.

export const BUILTIN_CATALOG = {
  apps: [
    {
      name: 'Nginx Proxy Manager',
      description:
        "The friendly way to put your services on real domains: a web UI for reverse-proxy routes with free Let's Encrypt HTTPS. homeport can read and manage it for you.",
      categories: ['Reverse proxy'],
      icon: 'nginx-proxy-manager',
      image: 'jc21/nginx-proxy-manager:latest',
      notes:
        'After it starts, click “Connect it” on homeport\'s dashboard — homeport rotates the default password and turns proxy management on for you (or set it up by hand in Settings → Proxy management with admin@example.com / changeme). It joins the shared "npm-network", so homeport reaches its API at http://nginx-proxy-manager:81. Ports 80 and 443 must be free on the host.',
      inputs: [{ name: 'ADMIN_PORT', label: 'Admin UI port', default: '81', required: true }],
      compose: `services:
  nginx-proxy-manager:
    image: jc21/nginx-proxy-manager:latest
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "{{ADMIN_PORT}}:81"
    volumes:
      - data:/data
      - letsencrypt:/etc/letsencrypt
    networks:
      - npm-network
volumes:
  data:
  letsencrypt:
networks:
  npm-network:
    external: true
`,
    },
    {
      name: 'Uptime Kuma',
      description: 'Self-hosted uptime monitoring with status pages and notifications.',
      categories: ['Monitoring'],
      icon: 'uptime-kuma',
      image: 'louislam/uptime-kuma:1',
      inputs: [
        { name: 'PORT', label: 'Host port', default: '3001', required: true },
      ],
      compose: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: unless-stopped
    ports:
      - "{{PORT}}:3001"
    volumes:
      - data:/app/data
volumes:
  data:
`,
    },
    {
      name: 'Vaultwarden',
      description: 'Lightweight Bitwarden-compatible password manager server.',
      categories: ['Security'],
      icon: 'vaultwarden',
      image: 'vaultwarden/server:latest',
      notes: 'Put it behind HTTPS (reverse proxy) before real use — browsers require a secure context for the web vault.',
      inputs: [
        { name: 'PORT', label: 'Host port', default: '8222', required: true },
      ],
      compose: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    restart: unless-stopped
    ports:
      - "{{PORT}}:80"
    volumes:
      - data:/data
volumes:
  data:
`,
    },
    {
      name: 'Jellyfin',
      description: 'Free media server for movies, shows and music.',
      categories: ['Media'],
      icon: 'jellyfin',
      image: 'jellyfin/jellyfin:latest',
      inputs: [
        { name: 'PORT', label: 'Host port', default: '8096', required: true },
        { name: 'MEDIA_DIR', label: 'Media folder (host path)', description: 'Mounted read-only at /media', required: true },
      ],
      compose: `services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    restart: unless-stopped
    ports:
      - "{{PORT}}:8096"
    volumes:
      - config:/config
      - cache:/cache
      - "{{MEDIA_DIR}}:/media:ro"
volumes:
  config:
  cache:
`,
    },
    {
      name: 'AdGuard Home',
      description: 'Network-wide ad and tracker blocking DNS server.',
      categories: ['Network'],
      icon: 'adguard-home',
      image: 'adguard/adguardhome:latest',
      notes: 'Uses host port 53 for DNS — make sure nothing else (e.g. systemd-resolved) is bound to it.',
      inputs: [
        { name: 'WEB_PORT', label: 'Web UI port', default: '3000', required: true },
      ],
      compose: `services:
  adguardhome:
    image: adguard/adguardhome:latest
    restart: unless-stopped
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "{{WEB_PORT}}:3000"
    volumes:
      - work:/opt/adguardhome/work
      - conf:/opt/adguardhome/conf
volumes:
  work:
  conf:
`,
    },
    {
      name: 'Gitea',
      description: 'Lightweight self-hosted Git service with a GitHub-like UI.',
      categories: ['Development'],
      icon: 'gitea',
      image: 'gitea/gitea:latest',
      inputs: [
        { name: 'HTTP_PORT', label: 'Web port', default: '3000', required: true },
        { name: 'SSH_PORT', label: 'SSH port', default: '2222', required: true },
      ],
      compose: `services:
  gitea:
    image: gitea/gitea:latest
    restart: unless-stopped
    environment:
      USER_UID: "1000"
      USER_GID: "1000"
    ports:
      - "{{HTTP_PORT}}:3000"
      - "{{SSH_PORT}}:22"
    volumes:
      - data:/data
volumes:
  data:
`,
    },
    {
      name: 'Syncthing',
      description: 'Continuous peer-to-peer file synchronization.',
      categories: ['Files'],
      icon: 'syncthing',
      image: 'syncthing/syncthing:latest',
      inputs: [
        { name: 'GUI_PORT', label: 'Web UI port', default: '8384', required: true },
        { name: 'DATA_DIR', label: 'Sync folder (host path)', description: 'Mounted at /var/syncthing', required: true },
      ],
      compose: `services:
  syncthing:
    image: syncthing/syncthing:latest
    restart: unless-stopped
    ports:
      - "{{GUI_PORT}}:8384"
      - "22000:22000/tcp"
      - "22000:22000/udp"
    volumes:
      - "{{DATA_DIR}}:/var/syncthing"
`,
    },
    {
      name: 'Home Assistant',
      description: 'Open-source home automation hub.',
      categories: ['Home Automation'],
      icon: 'home-assistant',
      image: 'ghcr.io/home-assistant/home-assistant:stable',
      notes: 'Runs with host networking so device discovery (mDNS, SSDP) works — the UI is on port 8123.',
      inputs: [
        { name: 'TZ', label: 'Timezone', default: 'Etc/UTC' },
      ],
      compose: `services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    restart: unless-stopped
    network_mode: host
    environment:
      TZ: "{{TZ}}"
    volumes:
      - config:/config
volumes:
  config:
`,
    },
    {
      name: 'Grafana',
      description: 'Dashboards and visualization for metrics and logs.',
      categories: ['Monitoring'],
      icon: 'grafana',
      image: 'grafana/grafana-oss:latest',
      inputs: [
        { name: 'PORT', label: 'Host port', default: '3000', required: true },
      ],
      compose: `services:
  grafana:
    image: grafana/grafana-oss:latest
    restart: unless-stopped
    ports:
      - "{{PORT}}:3000"
    volumes:
      - data:/var/lib/grafana
volumes:
  data:
`,
    },
    {
      name: 'n8n',
      description: 'Workflow automation with a visual editor (self-hosted Zapier alternative).',
      categories: ['Automation'],
      icon: 'n8n',
      image: 'docker.n8n.io/n8nio/n8n:latest',
      inputs: [
        { name: 'PORT', label: 'Host port', default: '5678', required: true },
        { name: 'TZ', label: 'Timezone', default: 'Etc/UTC' },
      ],
      compose: `services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    restart: unless-stopped
    ports:
      - "{{PORT}}:5678"
    environment:
      GENERIC_TIMEZONE: "{{TZ}}"
      TZ: "{{TZ}}"
    volumes:
      - data:/home/node/.n8n
volumes:
  data:
`,
    },
    {
      name: 'Navidrome',
      description: 'Modern music server and streamer (Subsonic-compatible).',
      categories: ['Media'],
      icon: 'navidrome',
      image: 'deluan/navidrome:latest',
      inputs: [
        { name: 'PORT', label: 'Host port', default: '4533', required: true },
        { name: 'MUSIC_DIR', label: 'Music folder (host path)', description: 'Mounted read-only at /music', required: true },
      ],
      compose: `services:
  navidrome:
    image: deluan/navidrome:latest
    restart: unless-stopped
    ports:
      - "{{PORT}}:4533"
    volumes:
      - data:/data
      - "{{MUSIC_DIR}}:/music:ro"
volumes:
  data:
`,
    },
    {
      name: 'FreshRSS',
      description: 'Self-hosted RSS feed aggregator.',
      categories: ['News'],
      icon: 'freshrss',
      image: 'freshrss/freshrss:latest',
      inputs: [
        { name: 'PORT', label: 'Host port', default: '8081', required: true },
        { name: 'TZ', label: 'Timezone', default: 'Etc/UTC' },
      ],
      compose: `services:
  freshrss:
    image: freshrss/freshrss:latest
    restart: unless-stopped
    ports:
      - "{{PORT}}:80"
    environment:
      TZ: "{{TZ}}"
      CRON_MIN: "1,31"
    volumes:
      - data:/var/www/FreshRSS/data
      - extensions:/var/www/FreshRSS/extensions
volumes:
  data:
  extensions:
`,
    },
    {
      name: 'code-server',
      description: 'VS Code in the browser, running on your own server.',
      categories: ['Development'],
      icon: 'code-server',
      image: 'lscr.io/linuxserver/code-server:latest',
      inputs: [
        { name: 'PORT', label: 'Host port', default: '8443', required: true },
        { name: 'PASSWORD', label: 'Web UI password', required: true },
        { name: 'TZ', label: 'Timezone', default: 'Etc/UTC' },
      ],
      compose: `services:
  code-server:
    image: lscr.io/linuxserver/code-server:latest
    restart: unless-stopped
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: "{{TZ}}"
      PASSWORD: "{{PASSWORD}}"
    ports:
      - "{{PORT}}:8443"
    volumes:
      - config:/config
volumes:
  config:
`,
    },
  ],
}
