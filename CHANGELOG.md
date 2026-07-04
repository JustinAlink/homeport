# Changelog

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
