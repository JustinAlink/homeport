# Operations & advanced topics

Deeper homeport topics, split out of the main [README](../README.md#compose-stacks) to keep it lean:
the file browser, adopting projects started outside homeport, the networks and storage managers,
complete deletes, "Pool overlaps" troubleshooting, the health check, and the exposure report.

## File browser

Each stack page has a **Files** section over the stack's directory (external/adopted projects
included): browse, edit (with a `.bak` of every overwrite), create, rename, delete, upload,
and download. `.env` and config files live next to the compose file — exactly where compose
expects them — so setting secrets before the first `up` is an in-app flow. Safety rails:
paths can't escape the stack directory (traversal *and* symlink checks), `.git` internals are
off limits, the compose file can't be deleted or renamed and is validated on save, binary or
huge files are download-only.

## Adopting projects that live anywhere (compose roots & adoption)

Projects that were started outside homeport (a `docker compose up` over SSH, an old
`~/docker/*` tree) don't have to move into the stacks dir. Mount their directory into the
homeport container **at the same path it has on the host** — e.g.
`-v /home/user/docker:/home/user/docker` — and:

- Running compose projects whose `working_dir` is visible are **adopted automatically**:
  edited and compose-operated in place, marked `external` in the UI. (The same-path rule
  matters — compose resolves relative bind mounts against the file's directory, and the
  daemon interprets those paths on the host.)
- Add the folder under **Settings → Capabilities → Compose roots** (or `HOMEPORT_COMPOSE_ROOTS`, comma-
  separated) and every subfolder with a compose file becomes a stack **even before its
  containers exist** — create a project over SSH, then set its env and start it from
  homeport.
- Projects homeport can't see stay **unmanaged** — visible and controllable, with the exact
  host path you'd need to mount shown on the stacks page.
- External stacks can't be deleted from homeport (it won't remove files outside its own
  stacks dir), and homeport refuses `down`/`restart` on its **own** stack (use
  the **Update homeport** button in the sidebar or under Settings → Backup & about instead).

## Networks

Containers reach each other by name only when they share a network. **/networks** is built
around that: **shared networks** (the ones connecting stacks, such as the reverse proxy's) come
first and show which stacks and containers each one connects; every stack's private default
network and Docker's built-ins sit in collapsed sections below. Unused networks are marked and
can be removed (built-ins and anything still referenced are refused); deleting a stack also
sweeps its leftover networks, the classic cause of "Pool overlaps" on a later install.

**Connecting a container** to a network works live, and for a container in a stack homeport
manages it is also written into the stack's compose file (the service keeps its `default`
network, the shared one is declared `external: true`), so the stack's next start doesn't undo
it. Disconnecting offers the same.

**Proxy reachability.** homeport finds the reverse-proxy container (Nginx Proxy Manager,
Traefik, Caddy) and checks that every container with a domain routed to it by name shares a
network with it. If not, the domain can only answer with an error, so the dashboard, the
container page and the domain form say so, with a one-click "Connect to <proxy network>".

New networks take a name and an optional subnet (validated against existing ranges up front, so
no bare "Pool overlaps"). Subnets can't be edited in place (docker has no API for it): change them
in the owning compose file, or remove and recreate an unused network.

## Storage

**/storage** lists every volume and image on the host with what references it. Data that
outlived a deleted stack or container (deletes keep volumes by default) shows up here as
*unused* and can be removed — volumes with a hard two-step confirm (that's your data),
images casually (worst case is a re-pull). Volume disk usage is computed on demand
("Calculate sizes" — it walks the volume contents).

## Deleting things completely

Deletes are conservative by default (data outlives the container), with opt-in checkboxes for
a full cleanup:

- **Stack delete**: also delete named volumes (the stack's data), also delete its images, and
  also remove its domains from the reverse proxy (when proxy management is enabled).
- **Container delete** (service page danger zone): also delete anonymous volumes, its image,
  and its proxy domains — the matching routes are shown before you confirm.

## When a deploy fails on "Pool overlaps"

Some upstream compose files pin a fixed subnet (`ipam: … subnet:`) that may already be taken
on your machine — docker then fails with the famously unhelpful
`Pool overlaps with other one on this address space`. Homeport diagnoses this: the op output
names the conflicting network, and the stack page shows a card listing every docker network
(subnet + how many containers use it) with one-click **removal of unused networks**, then
retry. Pool-exhaustion errors (too many networks) get the same treatment.

## Health check

`GET /healthz` answers `200 {"status":"ok"}` while homeport can reach at least one Docker
host, and `503` when it can't (`docker-unreachable`) or its background collector has not
produced a snapshot for a while (`collector-stalled`, 10 minutes or ten collector
intervals, whichever is longer; update checks and auto-updates run beside the collector,
so a slow pull never trips it). It sits outside `/api/`, so it needs no login or token, and it
reveals nothing beyond that one word. The image's `HEALTHCHECK` uses it, which makes a
homeport that lost its Docker connection show as `unhealthy` in `docker ps`; point Uptime
Kuma or any other monitor at the same URL. It reads the collector's last result rather than
calling Docker, so frequent probes cost nothing.

## Exposure report

**Exposure** (sidebar, or <kbd>G</kbd> <kbd>X</kbd>) shows how each running app can be reached: by its
domain through the reverse proxy, and directly through any port published on the machine. Ports and
their listen addresses come from Docker, domains from the proxy's config. For the login and the HTTP
redirect, homeport fetches each domain's front page as an anonymous visitor would, and once more over
`http://`, through the same proxy fallback as the domain checks (so it works on servers that can't
reach their own public address from inside Docker).

| Finding | Level | When |
|---|---|---|
| Reachable around the proxy | needs attention | the app has a domain, and also a port published on every interface: `http://<host>:<port>` skips the proxy's HTTPS and any login in front of it |
| Controls Docker and is reachable | needs attention | it mounts the Docker socket and has a domain or an open port |
| The proxy's admin port is open | worth a look (Caddy's admin API: needs attention) | the proxy publishes its admin UI or API (NPM 81, Traefik 8080, Caddy 2019) on every interface |
| A database is open on every interface | worth a look | Postgres, MySQL/MariaDB, Mongo, Redis and similar, published with no domain |
| Served without HTTPS / plain HTTP still works | worth a look | a route without a certificate, or `http://` serving the app instead of redirecting |
| Open on every interface | open ports | anything else published on every interface without a domain (often intended: a game server) |

"Every interface" means every network interface of the machine. Whether that includes the internet
depends on your router or cloud firewall, which homeport can't see, but note that Docker's published
ports skip ufw and firewalld. An app whose page opens for anyone may still have its own login; homeport
shows that as a fact and doesn't flag it.

**Accept** marks a finding as intended, with a reason (for example a media server's LAN port next to
its domain). It stays listed as accepted and stops counting, survives a container recreate (it is
stored by container name and rule in `exposure.json` in the data dir), and a different finding on the
same container still shows. Nothing in your setup changes. Viewers and read-only tokens can see the
report but not accept findings.
