# Domain sources

homeport shows which domain points at which container by reading your reverse proxy. Besides
the config readers in the main [README](../README.md) (Nginx Proxy Manager, plain Nginx, a
Caddyfile, a Traefik dynamic file, Traefik Docker labels), it reads three more sources:

| Source | What it reads | How to enable |
|---|---|---|
| **Traefik (API)** | Every router and service Traefik is running, from all its providers at once | `HOMEPORT_TRAEFIK_API_URL=http://traefik:8080` |
| **caddy-docker-proxy (labels)** | `caddy` / `caddy_N` labels on your containers | automatic when a caddy-docker-proxy container runs on the host |
| **Pangolin (labels)** | `pangolin.public-resources.*` blueprint labels on your containers | automatic when a Newt or pangolin site container runs on the host |

All three are **read-only**: homeport shows their domains but never creates or edits routes
through them. Domain management (Settings, Proxy management) keeps working through whichever
writable proxy you configured (NPM, Caddy's admin API, a Traefik dynamic file).

Each domain on a service page says where it came from ("from Traefik (API)"), and so does
each entry under "Domains without a container" on the dashboard.

## Traefik API

The API is Traefik's own runtime view, so one read covers the Docker provider, the file
provider, Kubernetes (CRD and Ingress), Consul and the rest. The label and file readers each see
only one of those.

Traefik serves its API on the `traefik` entrypoint (port 8080) when `api.insecure` is on, or
behind a router to `api@internal` that you protect yourself. **Keep it internal**: put homeport
on a Docker network it shares with Traefik and use the container name. Never publish 8080.

```yaml
services:
  traefik:
    image: traefik:v3.6
    command:
      - --api.insecure=true          # API on the internal `traefik` entrypoint, :8080
      - --providers.docker=true
    networks: [proxy]                # no `ports:` entry for 8080

  homeport:
    environment:
      HOMEPORT_TRAEFIK_API_URL: http://traefik:8080
    networks: [proxy]
```

If the API sits behind a `basicAuth` middleware, add the login:

| Variable | Meaning |
|---|---|
| `HOMEPORT_TRAEFIK_API_URL` | Base URL of the API (with or without a trailing `/api`), including any `api.basePath` |
| `HOMEPORT_TRAEFIK_API_USER` | Basic-auth user (optional) |
| `HOMEPORT_TRAEFIK_API_PASSWORD` | Basic-auth password (optional) |

The same fields are under **Settings, Proxy** (choose "Traefik (API)"), and per host in the
multi-host list. The password is stored in `settings.json`, never sent back to the browser,
and kept on save only while the URL points at the same server: change the URL to another
server and it has to be typed again. **Test provider** tries what is on screen before you save.

How routes are read:

- `Host(`a`) || Host(`b`)` and the v2 form `Host(`a`, `b`)` give both domains. `HostRegexp`
  and negated hosts are skipped, as are routers Traefik reports as disabled.
- A router with `tls` is HTTPS. The usual pair of an HTTP router that only redirects and an
  HTTPS router for the same host and service shows as one HTTPS domain.
- The service's load-balancer servers are the upstreams. Weighted (canary) services count every
  branch; mirroring and failover count the main service. Internal services (`api@internal`,
  `noop@internal`) are ignored.
- The Docker provider reports a container's own IP (`http://172.18.0.3:80`). homeport matches
  that IP to the container, so the domain lands on the right app even when another container
  publishes the same port number on the host.
- Kubernetes pods are not containers homeport lists, so their routes appear under "Domains
  without a container".

When the API cannot be reached, its domains are left out and the error is logged once
(`[domains]` in `docker logs homeport`); the host itself stays online.

In auto-detect, the Traefik API is used when its URL is set and no NPM, Caddyfile or Nginx path
is. It is preferred over a Traefik file path (it already includes the file's routes), and
Traefik container labels are then not read separately.

## caddy-docker-proxy

[caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy) turns container labels
into a Caddyfile. homeport reads the same labels:

```yaml
labels:
  caddy: app.example.com, www.app.example.com
  caddy.reverse_proxy: "{{upstreams 8080}}"
```

- `caddy_0`, `caddy_1`, ... are separate sites on one container.
- `{{upstreams}}` is the labelled container itself; its port is the number given, 443 for
  `{{upstreams https}}`, 80 otherwise, or the lowest exposed port for `lowestExposedPort`.
- `reverse_proxy` is found at any depth (`caddy.handle_path.0_reverse_proxy`), with matchers
  (`@ws {{upstreams}}`) and the block form (`caddy.reverse_proxy.to`). A literal upstream such as
  `other-app:9000` maps the domain to that container instead.
- `http://` addresses (or `:80`) are plain HTTP; everything else is HTTPS, as Caddy serves it.
- Snippets, global options, wildcard and placeholder addresses are skipped.

Auto-detect reads these labels whenever a container from the `lucaslorentz/caddy-docker-proxy`
image, or any container whose command is `caddy docker-proxy` (custom builds with DNS plugins),
exists on the host. Choose "caddy-docker-proxy (labels)" to read them without that check.

Not covered: a custom `CADDY_DOCKER_LABEL_PREFIX`, and Swarm service labels (homeport lists
containers, not services).

## Pangolin

[Pangolin](https://docs.pangolin.net/manage/blueprints) blueprints can live in container labels,
applied by a site (Newt, or `pangolin up site`) that has the Docker socket. homeport reads the
public resources:

```yaml
labels:
  - pangolin.public-resources.wiki.full-domain=wiki.example.com
  - pangolin.public-resources.wiki.mode=http
  - pangolin.public-resources.wiki.targets[0].method=http
  - pangolin.public-resources.wiki.targets[0].port=3000
```

- A target without `hostname` is the labelled container; without `port`, its lowest exposed port.
- Labels from several containers merge into one resource, as Pangolin does: one container can
  hold the domain and another add a target.
- Only `http` resources have a domain. `tcp` / `udp` resources, disabled resources
  (`enabled=false`), disabled targets and wildcard domains are skipped.
- HTTPS unless the resource says `ssl=false`.
- The older `pangolin.proxy-resources.*` and `protocol=` spellings work too.

Auto-detect reads these labels whenever a `fosrl/newt` or `fosrl/pangolin-cli` container (or a
container running `newt`) exists on the host. Choose "Pangolin (labels)" to read them without
that check. Resources made in Pangolin's dashboard, rather than labels, are not visible to
homeport.

## How sources combine

- One **primary** source per host, chosen as before: `DOMAIN_PROVIDER` if set, else the first of
  NPM, Caddyfile, Nginx, Traefik API, Traefik file that is configured. With none of those,
  Traefik container labels.
- **caddy-docker-proxy and Pangolin labels are added on top** whenever their container is on the
  host, whatever the primary is. A host can serve some apps through NPM and others through a
  Pangolin tunnel; both show.
- The dashboard header names every source that found something, e.g.
  "domains via Nginx Proxy Manager + Pangolin".
- The same domain from two sources shows once per container, HTTPS winning.

`DOMAIN_PROVIDER` accepts `npm`, `nginx`, `caddy`, `traefik`, `traefik-file`, `traefik-api`,
`caddy-docker-proxy` and `pangolin`. A host that runs neither caddy-docker-proxy nor a Pangolin
site, and has no Traefik API URL set, reads exactly what it read before.
