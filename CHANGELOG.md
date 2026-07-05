# Changelog

## v2.6.0 — 2026-07-05

- **Updates view**: a dedicated page (sidebar → Updates, with a pending-count
  badge) listing every container with a newer image, grouped by compose
  project. Managed stacks get **Pull & up** with live output; unmanaged
  projects and standalone containers get one-click **Update (all)** with
  per-container progress. Images that failed their registry check are listed
  with the reason.
- **Capability probe**: Settings → Capabilities can now ask the Docker socket
  proxy what it actually allows (harmless probes against nonexistent targets —
  a 403 means blocked, reaching the daemon means allowed). Each capability
  toggle shows a green/red/amber verdict with the missing proxy permission
  named, so "the button exists but 403s when clicked" can't happen silently.

## v2.5.0 — 2026-07-05

**Unmanaged compose projects are first-class now.**

- **Fix: updating a compose-managed container no longer dead-ends in "Unknown
  stack".** Containers from compose projects homeport has no stack directory for
  (started elsewhere on the host) can now be updated directly — pull + recreate
  in place, labels preserved. The "update via stack" hand-off only appears when
  homeport actually manages that stack.
- **Stack pages for unmanaged projects**: opening a compose project without a
  stack dir shows its containers with live stats, start/restart/stop-all
  controls, and an explanation of how to make it fully managed — instead of an
  "Unknown stack" error.
- **Dashboard stack names are links** — click a group name to open its stack
  page; the row still collapses the group. Unmanaged rows on the stacks page are
  clickable too, and every stack page now lists its services.
- **Service page controls rebuilt**: a proper segmented Restart / Stop group
  (filled Start button when the container is down) with aligned icons and busy
  states, replacing the old mismatched buttons.
- **Terminal failures explain themselves**: a WebSocket that never opens now
  says so and points at reverse-proxy WebSocket support (NPM "Websockets
  Support"); an exec blocked by the Docker socket proxy points at `EXEC=1`.
- **Updates no longer orphan the page.** A direct update recreates the container
  under a new id — the service page now keeps rendering through the recreate
  (no "service not found" flash) and follows to the new container's page when
  the update lands cleanly. Stack pages keep their rows visible (marked
  "recreating…") instead of claiming the project vanished.
- **Whole-project updates**: stack pages show an "update" badge per container,
  and unmanaged projects get an **Update all** button that pulls + recreates
  every outdated container in turn with live progress. Applied updates clear
  their badge immediately instead of waiting for the next daily check.

## v2.4.0 — 2026-07-05

**The big UI/UX revamp.**

- **Light theme** alongside dark, with a sidebar toggle (dark / light / follow-OS),
  no-flash boot, powered by a full design-token system.
- **Left sidebar navigation** replaces the crowded per-page header buttons; mobile
  gets a drawer. Brand accent is now indigo; emerald means *status* (running/healthy).
- **Service cards rebuilt**: icon tile, full name + image ref, status text with a
  quiet dot (loud pills only for exceptional states), domain/port chips, CPU/RAM
  bars with live values, and a full-width CPU+RAM sparkline. Update badge sits on
  the icon corner. Wider layouts on every page; fleet graph shown by default.
- **Icons, not emoji**: a single stroke-icon registry replaces every emoji/symbol
  in the chrome.
- **Stacks page explains itself** and shows each stack's services + live CPU/RAM totals.
- Catalog categories from community sources are cleaned (comma/camelCase mashes split,
  known-broken ones aliased).

## v2.3.2 — 2026-07-04

- **Fix: self-update helper mangled relative bind mounts.** The helper now mounts
  the compose project at its real host path (and works from there), so relative
  binds like `./stacks` survive the recreate. v2.3.0's helper could re-bind them
  to a bogus host `/project/*` path.
- Self-update now answers **"already up to date"** instead of silently doing
  nothing, and keeps its (label-tagged) helper containers for debugging,
  cleaning them up on the next run.
- **`/api/stats` serves the background collector's snapshot** when fresh (live
  sweep on demand with `?live=1`): first paint on large fleets went from
  many seconds to instant, and per-request Docker load dropped to zero.
- Young history series (e.g. the new System RAM) no longer draw misleading
  leading zeros — gaps before the first data point take the first real value.

## v2.3.1 — 2026-07-04

- **Start-on-boot control**: every container's page (Overview) gets a restart-policy
  selector — `unless-stopped` / `always` / `on-failure` / `no` — applied live via
  `docker update`, no recreate. Control-capability gated; compose-managed containers
  get an honest note that the compose file wins on recreate.

## v2.3.0 — 2026-07-04

- **Self-update from the UI** (Settings → About): a short-lived helper container
  pulls the new image and recreates homeport from outside; the UI reconnects on
  its own. Needs the *apply updates* capability and a compose-managed homeport.
- **Whole-machine stats**: the fleet graph and RAM widget now show what the
  *host* uses beyond containers (violet/amber series; procfs-based, zero extra
  mounts). Honest numbers — page cache is not counted as "used".
- **Instant graphs**: the fleet graph defaults to the server-side 1h history
  instead of an empty live buffer; range choice is remembered.
- Contributor docs: CONTRIBUTING, SECURITY policy, issue/PR templates.
- Multi-arch image: `linux/amd64` + `linux/arm64`.

## v2.2.0 — 2026-07-04

- **Git-backed stacks**: deploy a stack straight from a git repository
  (`/stacks → New stack → From git repository`) and update it with one click
  when the repo moves — fetch, hard-reset, `compose up -d --build`, streamed
  live. Private repos use a per-stack access token (stored 0600 server-side,
  injected as a header, never in `.git/config`, scrubbed from output).

## v2.1.1 — 2026-07-04

- Catalog UX: source health in a header popover, pagination (24/page),
  normalized/merged categories with ranked pills, card polish, skeleton
  loading, two-column install form, "what will run" compose preview.
- The official Portainer community template list ships as a default source
  (~300 apps out of the box) plus one-click suggested sources in settings.

## v2.1.0 — 2026-07-04

- **App catalog** (`/catalog`): browse curated built-ins + community template
  sources (Portainer `templates.json` v2/v3 container templates are converted
  to compose automatically) and one-click install any app as a normal compose
  stack, with a guided form (ports, paths, passwords, port-clash warnings).

## v2.0.x — 2026-06

- v2.0.4: socket-proxy 403s on update checks are explained instead of dumping HTML.
- v2.0.3: the per-container Domains tab prefills from the existing proxy route.
- v2.0.2: hard timeouts on one-shot Docker calls (no more stuck "Loading…" via
  half-open proxy connections); SSE unbuffered behind proxies; server error
  messages surface in the UI.
- v2.0.1: single-host deploys got the proxy-admin credentials wiring.

## v2.0.0 — 2026-06-15

Management release: capability framework (tiered opt-ins), container logs,
restart controls, image update checks + one-click apply, dedicated service
pages, web terminal, compose stack manager, reverse-proxy admin (NPM / Caddy /
Traefik-file), settings UX with section nav, first-run in-app password setup.

## v1.0.0 — 2026-06-12

First release: zero-config status hub — container auto-discovery, domain
mapping from the reverse proxy (NPM/Traefik/Caddy/nginx), live SSE updates,
resource stats + graphs, uptime pings, systemd units, multi-host over SSH,
alerts with webhooks, demo mode.
