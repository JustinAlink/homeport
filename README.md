<div align="center">

# ⚓ homeport

**A zero-config status hub for your self-hosted Docker fleet.**

Point it at your Docker socket and your reverse proxy — it builds the dashboard for you.
No tiles to configure: every container shows up automatically, with its status and the
domain that points to it.

</div>

![homeport dashboard](docs/screenshot.png)

> Want to see it before wiring up Docker? Run it with `HOMEPORT_DEMO=true` for a
> synthetic fleet (the screenshot above is demo mode).

## Why

If you self-host, you already know what's running — it's just scattered across `docker ps`,
your reverse-proxy UI, and a dashboard you have to hand-edit every time you add a service.
homeport reads it all live:

- **Auto-discovers** every container (no manual config) — name, image, status, health, ports.
- **Auto-maps domains** from your reverse proxy. It knows `webapp → app.example.com`
  because it reads the proxy config — you don't tell it anything.
- **Live** — updates the moment a container starts, stops, or goes unhealthy (Docker events).
- **Uptime** — optionally HTTP-pings each mapped domain (up / down / latency dot).
- **systemd** — optionally shows host systemd services alongside containers.
- **Resource stats** — live CPU + memory per container with **sparkline graphs** (click to expand a CPU/RAM detail graph), per-stack totals, **resource-widget header** (CPU/RAM/running/cores), and a toggleable **fleet graph** with hover tooltips and a 1h/6h/24h history range.
- **Alerts** — optional notifications when a service goes down / unhealthy (and recovers), with anti-flap debounce and webhook channels (Discord / Slack / ntfy / custom).
- **Real app logos** (from the [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) CDN, monogram fallback).
- **Grouped by stack** (Docker Compose project) as cards — collapsible, searchable, dark by default.
- **Optional start/stop** controls (off by default — read-only unless you opt in).
- **In-app settings page** — pick your reverse proxy, set the Docker connection (local or remote-over-SSH, with host-key pinning), add/remove extra hosts, and toggle controls, uptime, systemd, and remote logos — all without editing env. (Env vars still win when set.)

It's a read-only *status hub*, not a management console — pair it with Portainer/Dockge if
you want to push buttons.

## Quick start

```yaml
# docker-compose.yml — see the full file in this repo
services:
  homeport:
    image: ghcr.io/<your-username>/homeport:latest
    environment:
      HOMEPORT_ADMIN_PASSWORD: change-me
      HOMEPORT_SESSION_SECRET: $(openssl rand -hex 32)
      DOCKER_HOST: tcp://docker-socket-proxy:2375
      NPM_CONF_DIR: /npm
    volumes:
      - /path/to/npm/data/nginx/proxy_host:/npm:ro   # optional: domain mapping
    ports: ["3004:3000"]
    networks: [npm-network, internal]
    depends_on: [docker-socket-proxy]

  docker-socket-proxy:                # read-only Docker API — no raw socket for the app
    image: tecnativa/docker-socket-proxy:latest
    environment: { CONTAINERS: 1, INFO: 1, EVENTS: 1, PING: 1 }
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"]
    networks: [internal]
```

```bash
cp .env.example .env   # set HOMEPORT_ADMIN_PASSWORD + HOMEPORT_SESSION_SECRET (+ NPM path)
docker compose up -d
# open http://<host>:3004 and log in
```

### Build & publish your own image (no CI required)

`docker-compose.yml` pulls `ghcr.io/<owner>/homeport`. To publish that image yourself —
no GitHub Actions needed — log in once and run the bundled script:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USER --password-stdin   # PAT w/ write:packages
GHCR_OWNER=yourname npm run publish:image            # → ghcr.io/yourname/homeport:latest
GHCR_OWNER=yourname npm run publish:image v0.3.0     # a specific tag
```

Multi-arch (amd64 + arm64) via buildx: `PLATFORMS=linux/amd64,linux/arm64 GHCR_OWNER=yourname npm run publish:image`.
Or skip the registry entirely and build on the host with `docker compose -f docker-compose.build.yml up -d --build`.

## Configuration

All via environment variables (set on the container at runtime):

| Variable | Default | Purpose |
|---|---|---|
| `HOMEPORT_ADMIN_PASSWORD` | — | Password for the single admin login (**required**). |
| `HOMEPORT_SESSION_SECRET` | dev fallback | Secret used to sign the session cookie. Set a long random value. |
| `DOCKER_HOST` | _(unix socket)_ | `tcp://docker-socket-proxy:2375` (recommended), `ssh://user@host` for a remote host, or empty for `DOCKER_SOCKET`. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Used only when `DOCKER_HOST` is empty. |
| `DOCKER_SSH_KEY` | _(agent)_ | Private-key path for `ssh://` (mount it read-only); falls back to the SSH agent. |
| `DOCKER_SSH_FINGERPRINT` | _(none)_ | Pin the remote host key for `ssh://`, e.g. `SHA256:…`. When set, a mismatching host key is rejected. |
| `HOMEPORT_HOSTS` | _(single host)_ | JSON array to watch several Docker hosts at once (see below). Locks the in-app Hosts list. |
| `HOMEPORT_REMOTE_ICONS` | `true` | `false` skips the dashboard-icons CDN — offline monograms / your own `hub.icon` URLs only. |
| `NPM_CONF_DIR` | _(none)_ | Path (in-container) to Nginx Proxy Manager proxy-host confs. Omit to disable domain mapping. |
| `NGINX_CONF_DIR` | _(none)_ | Path to a plain-Nginx confs dir (or single file) to map domains from `server_name`/`proxy_pass`. |
| `TRAEFIK_FILE` | _(none)_ | Path to a Traefik dynamic-config file or dir (YAML/TOML) for the file provider. |
| `HOMEPORT_DEMO` | `false` | `true` serves a synthetic fleet (no Docker needed) — handy for a first look. |
| `HOMEPORT_ALLOW_CONTROL` | `false` | `true` enables start/stop buttons. Requires the socket proxy to allow writes (`POST=1`). |
| `HOMEPORT_DATA_DIR` | `/data` | Where the **settings page** persists config. Mount a volume here to keep it. |
| `HOMEPORT_PING` | `true` | HTTP-ping mapped domains for an up/down dot. |
| `HOMEPORT_SYSTEMD` | `false` | Show host systemd services. Needs `systemctl` access (host install, or mount `/run/systemd` + the dbus socket). |
| `HOMEPORT_SYSTEMD_UNITS` | _(active+failed)_ | Comma list of units to show, e.g. `nginx,postgresql`. |
| `HOMEPORT_COLLECTOR_INTERVAL` | `30` | Seconds between background fleet snapshots (feeds history + alerts). Min 10. |
| `HOMEPORT_HISTORY` | `true` | Persist CPU/RAM history so graphs survive refresh/restart (stored under the data dir). |
| `HOMEPORT_ALERTS` | `false` | Enable per-service down/unhealthy/recovered notifications (configure channels in settings). |

> **Settings page** (the ⚙ in the header): change reverse-proxy provider, Docker connection
> (local / remote-over-SSH), add/remove **extra hosts**, toggle remote logos, and the controls
> toggle — all in-app. Any value also set via an env var is locked (env wins) — so headless
> deployments stay authoritative.

### Per-service overrides (optional Docker labels)

Zero-config by default; add labels to any container to customize its card:

| Label | Effect |
|---|---|
| `hub.name` | Display name |
| `hub.group` | Override the group/stack it's filed under |
| `hub.icon` | An emoji/character shown before the name |
| `hub.hide` | `true` to hide it from the dashboard |
| `hub.noalert` | `true` to exclude it from alerting |

## Reverse-proxy support

homeport reads your reverse proxy to map domains automatically:

| Provider | How | Config |
|---|---|---|
| **Nginx Proxy Manager** | Parses its generated nginx confs (read-only) | `NPM_CONF_DIR=/…/nginx/proxy_host` |
| **Nginx (plain)** | Parses `server_name` + `proxy_pass` from hand-written/SWAG configs (resolves `upstream` blocks) | `NGINX_CONF_DIR=/…/sites-enabled` (dir or single file) |
| **Traefik** | Reads `traefik.*` Docker labels (zero extra config) | nothing — works from the containers it already sees |
| **Traefik (file)** | Parses Traefik's dynamic-config file provider (YAML/TOML) | `TRAEFIK_FILE=/…/dynamic.yml` (file or dir) |
| **Caddy** | Parses your Caddyfile | `CADDYFILE_PATH=/…/Caddyfile` |

It **auto-detects** (NPM → Caddy → Nginx → Traefik-file → Traefik labels), or force one with
`DOMAIN_PROVIDER=npm|nginx|traefik|traefik-file|caddy`.
The layer is a small `DomainProvider` interface — more proxies are easy to add. PRs welcome.

## Watch a remote host (over SSH)

Run homeport anywhere and point it at a remote Docker host over SSH — no need to expose
the socket over TCP. Skip the socket-proxy and set:

```yaml
environment:
  DOCKER_HOST: ssh://user@your-server
  DOCKER_SSH_KEY: /ssh/id_ed25519   # in-container path
volumes:
  - /path/to/key:/ssh/id_ed25519:ro
```

The remote user must be able to reach its own `/var/run/docker.sock` (i.e. in the `docker`
group).

**Host-key verification.** Pin the remote host key with `DOCKER_SSH_FINGERPRINT=SHA256:…`
(grab it with `ssh-keyscan your-server | ssh-keygen -lf -`). When set, homeport rejects a
mismatching key instead of trusting on first use. Each entry in the multi-host list below
has its own optional fingerprint field too.

## Watch multiple hosts

Add hosts right from the **settings page** (Hosts → *+ Add host*), or set `HOMEPORT_HOSTS`
to a JSON array for headless deploys. Either way homeport aggregates them all — with a host
filter, host-tagged services, and per-host error isolation (a down host doesn't break the
rest). Each host can use any connection (local socket, tcp, or `ssh://`), its own reverse
proxy, and its own host-key fingerprint:

```jsonc
HOMEPORT_HOSTS='[
  { "name": "this-box" },
  { "name": "vps", "dockerHost": "ssh://user@vps", "dockerSshKey": "/ssh/id_ed25519",
    "sshFingerprint": "SHA256:…", "npmConfDir": "/npm" }
]'
```

Setting `HOMEPORT_HOSTS` locks the in-app Hosts list (env stays authoritative). With
neither set, homeport just watches the single host from the normal config.

## History & alerts

A small **background collector** snapshots the fleet every `HOMEPORT_COLLECTOR_INTERVAL`
seconds (default 30) — so history accrues and alerts fire even when nobody's looking at
the page.

- **History** is kept as tiny per-series JSON ring-buffers under
  `${HOMEPORT_DATA_DIR}/stats/` (zero-dependency, self-bounding ~24h). The fleet graph
  gains a 1h/6h/24h range that reads it back, so graphs survive a refresh or restart. Turn
  off with `HOMEPORT_HISTORY=false`.
- **Alerts** detect down / unhealthy / recovered transitions, debounced over N samples to
  avoid flapping, with a re-notify cooldown. Configure on the settings page: pick which
  transitions to notify on and add **webhook channels** — Discord, Slack, ntfy, or a custom
  JSON body with `{{name}} {{kind}} {{host}} {{from}} {{to}}` placeholders. A **Send test**
  button verifies each channel. Alert state + a recent-events log persist under
  `${HOMEPORT_DATA_DIR}/alerts/` so a homeport restart doesn't re-page every down service.
  Exclude a container with the `hub.noalert=true` label. Enable with `HOMEPORT_ALERTS=true`
  (or the settings toggle).

> Single container, single process: one collector runs per deployment. All of this degrades
> gracefully to in-memory if `HOMEPORT_DATA_DIR` isn't writable.

## Security

- homeport never touches the raw Docker socket — it talks to a **read-only
  `docker-socket-proxy`** that only exposes container listing, info, events, and ping.
  (Start/stop controls are off by default; enabling them needs `POST=1` on the proxy.)
- The reverse-proxy config is mounted **read-only**.
- The whole UI/API is behind a login (it reveals your infra) — set a real password and put
  it behind HTTPS via your reverse proxy.

## Roadmap

- More reverse-proxy providers — plain Nginx, Traefik file provider (community PRs welcome)
- Email/SMTP alert channel (webhooks land first)
- Per-container history range in the expandable card graph

## License

MIT © Juniper Gray (Justin Alink)
