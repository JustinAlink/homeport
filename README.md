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
- **Resource stats** — live CPU + memory per container, with **per-stack totals**.
- **Grouped by stack** (Docker Compose project) — collapsible, searchable, dark by default.
- **Optional start/stop** controls (off by default — read-only unless you opt in).
- **In-app settings page** — pick your reverse proxy, Docker connection (local or remote-over-SSH), and toggle controls without editing env. (Env vars still win when set.)

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

## Configuration

All via environment variables (set on the container at runtime):

| Variable | Default | Purpose |
|---|---|---|
| `HOMEPORT_ADMIN_PASSWORD` | — | Password for the single admin login (**required**). |
| `HOMEPORT_SESSION_SECRET` | dev fallback | Secret used to sign the session cookie. Set a long random value. |
| `DOCKER_HOST` | _(unix socket)_ | `tcp://docker-socket-proxy:2375` (recommended), `ssh://user@host` for a remote host, or empty for `DOCKER_SOCKET`. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Used only when `DOCKER_HOST` is empty. |
| `DOCKER_SSH_KEY` | _(agent)_ | Private-key path for `ssh://` (mount it read-only); falls back to the SSH agent. |
| `NPM_CONF_DIR` | _(none)_ | Path (in-container) to Nginx Proxy Manager proxy-host confs. Omit to disable domain mapping. |
| `HOMEPORT_DEMO` | `false` | `true` serves a synthetic fleet (no Docker needed) — handy for a first look. |
| `HOMEPORT_ALLOW_CONTROL` | `false` | `true` enables start/stop buttons. Requires the socket proxy to allow writes (`POST=1`). |
| `HOMEPORT_DATA_DIR` | `/data` | Where the **settings page** persists config. Mount a volume here to keep it. |
| `HOMEPORT_PING` | `true` | HTTP-ping mapped domains for an up/down dot. |
| `HOMEPORT_SYSTEMD` | `false` | Show host systemd services. Needs `systemctl` access (host install, or mount `/run/systemd` + the dbus socket). |
| `HOMEPORT_SYSTEMD_UNITS` | _(active+failed)_ | Comma list of units to show, e.g. `nginx,postgresql`. |

> **Settings page** (the ⚙ in the header): change reverse-proxy provider, Docker connection
> (local / remote-over-SSH), and the controls toggle in-app. Any value also set via an env
> var is locked (env wins) — so headless deployments stay authoritative.

### Per-service overrides (optional Docker labels)

Zero-config by default; add labels to any container to customize its card:

| Label | Effect |
|---|---|
| `hub.name` | Display name |
| `hub.group` | Override the group/stack it's filed under |
| `hub.icon` | An emoji/character shown before the name |
| `hub.hide` | `true` to hide it from the dashboard |

## Reverse-proxy support

homeport reads your reverse proxy to map domains automatically:

| Provider | How | Config |
|---|---|---|
| **Nginx Proxy Manager** | Parses its generated nginx confs (read-only) | `NPM_CONF_DIR=/…/nginx/proxy_host` |
| **Traefik** | Reads `traefik.*` Docker labels (zero extra config) | nothing — works from the containers it already sees |
| **Caddy** | Parses your Caddyfile | `CADDYFILE_PATH=/…/Caddyfile` |

It **auto-detects** (NPM → Caddy → Traefik), or force one with `DOMAIN_PROVIDER=npm|traefik|caddy`.
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
group). Note: in SSH mode homeport does not yet verify the remote host key — use it on
trusted networks / your own hosts.

## Security

- homeport never touches the raw Docker socket — it talks to a **read-only
  `docker-socket-proxy`** that only exposes container listing, info, events, and ping.
  (Start/stop controls are off by default; enabling them needs `POST=1` on the proxy.)
- The reverse-proxy config is mounted **read-only**.
- The whole UI/API is behind a login (it reveals your infra) — set a real password and put
  it behind HTTPS via your reverse proxy.

## Roadmap

- Live per-container graphs (CPU/mem history)
- Multi-host
- SSH host-key verification (remote mode)

## License

MIT © Juniper Gray (Justin Alink)
