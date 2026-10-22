# Operations & advanced topics

Deeper homeport topics, split out of the main [README](../README.md#compose-stacks) to keep it lean:
the file browser, adopting projects started outside homeport, the networks and storage managers,
complete deletes, and "Pool overlaps" troubleshooting.

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
