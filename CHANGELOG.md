# Changelog

## v2.33.1 (2026-10-24)

- **The `managed-by` marker also works in an override file.** homeport read it
  only from the stack's main compose file, but some main files belong to their
  own updater (mailcow's `update.sh` rewrites `docker-compose.yml`), so the marker
  can only live in the override file compose loads next to it. homeport now reads
  `compose.override.yaml` / `docker-compose.override.yml` (and their `.yml` /
  `.yaml` twins) too; the main file's marker wins when both have one.

## v2.33.0 (2026-10-24)

Lessons from running homeport on a real server.

- **homeport says what its NPM user may do.** An NPM user starts with NPM's
  defaults ("own items only"), so homeport signed in fine and silently listed none
  of the existing proxy hosts. It now reads the user's permissions and says so on
  the Domains page and in the connection test: sees only its own hosts, can see
  but not change proxy hosts, or is an administrator (a dedicated user is safer).
  Edit buttons it couldn't use are hidden, and a refusal from NPM (403) explains
  itself.
- **Stacks another tool owns.** A compose file can name its owner with
  `x-homeport: managed-by: ...` (compose ignores `x-` keys). homeport then never
  writes it (version switch, network and restart/limit saves point to the owner),
  shows a "managed by" badge, and asks before a hand edit, like a git-backed stack.
- **Domain alerts.** With alerts on, a running container's domain that answers 5xx
  or nothing for the debounce count notifies through your channels ("answers
  again" on recovery), and shows in Activity. On by default; a switch under
  Monitoring & alerts turns it off.
- **A readable usage chart on big servers.** The dashboard chart fits its scale
  to the data on round steps (5, 10, 25 ... 100%) with labelled values, instead
  of flat lines at the bottom of a 0 to 100% scale.
- **Two-factor nudge.** The admin who signs in with a password and has two-factor
  off sees a short note on the dashboard with a link to turn it on ("Not now"
  hides it for 30 days).
- **More reliable releases.** The image installs exactly the tested lockfile
  (`npm ci`) and retries once on esbuild's "text file busy" flake, which failed
  the v2.31.2 build. CI installs Chromium without system packages unless a
  launch needs them; those once took 12 minutes from a slow apt mirror.

## v2.32.1 (2026-10-22)

- **NPM accounts with two-factor authentication get a clear answer.** NPM's API
  cannot complete a login for an account with 2FA (it asks for a code instead of
  handing out a token), and homeport reported that as "NPM login failed (200)".
  It now says what happened and what to do: give homeport its own NPM user
  without 2FA (Proxy Hosts: Manage, Certificates: View), so your own account
  keeps it. A wrong password now says so too.

## v2.32.0 (2026-10-22)

Security: a fresh install can no longer be claimed by a stranger.

- **First-run setup needs a one-time code from homeport's log.** Until an admin
  password existed, the setup screen was open to anyone who reached it, so an
  install that was reachable from the internet before you finished setup could be
  taken over, along with control of Docker, by whoever found it first. Setup now
  asks for a code that homeport prints to its log when it starts
  (`docker logs homeport 2>&1 | grep "setup code"`), so only someone with access
  to the server can finish it. The code is kept in memory and a restart makes a
  new one; wrong codes are rate-limited and logged; it prints even with
  `HOMEPORT_LOG_LEVEL=silent`. `install.sh` prints a link with the code already
  filled in. Setting `HOMEPORT_ADMIN_PASSWORD` still skips setup entirely.
- **"Skip and run without a login" is gone from the setup screen.** Running with
  no login now needs `HOMEPORT_ALLOW_OPEN=true` in homeport's environment, where
  it shows up in your compose file instead of being one click any visitor could
  make.
- **Upgrade note:** if you chose "skip" in an older version, homeport shows the
  setup screen after this update (the startup log says why). Create a password
  with the code from the log, or set `HOMEPORT_ALLOW_OPEN=true` to keep running
  without a login.
- Also ships everything from v2.31.2 (domain checks that fall back to the
  reverse proxy, the warning before editing a git-tracked file).

## v2.31.2 (2026-10-22)

No image or GitHub release was published for this tag (its image build hit a
transient npm error); these changes ship in v2.32.0.


- **Bug: every domain looked down on servers that can't reach their own public
  address.** From inside Docker, many servers can't connect to their own public IP
  (no NAT loopback on a home router, or a firewall that drops a container's
  traffic to the host), so the domain check marked every site "doesn't answer"
  and filled Needs attention with false alarms. When the public route gets no
  answer, the check now asks your reverse-proxy container directly (by container
  name, with the domain as Host header and TLS name) and labels the result
  "via proxy". A domain that fails both ways still shows as down.
- **Editing a git-tracked file in a git-backed stack now warns first.** "Update
  from git" resets tracked files to the repository, so the compose editor and the
  stack's file editor say so for those files and ask once before saving.
  Untracked files (a gitignored `.env`, a generated compose file) survive the
  reset and get no warning.

## v2.31.1 (2026-10-22)

- **Bug: changes saved into a git-backed stack's compose file didn't last.**
  "Update from git" resets the stack folder to the repository, so a version
  switch, a network connection or a restart/limit saved into its compose file
  was silently undone by the next update. homeport now refuses to write a git
  stack's files (HTTP 409 with the reason) and says to make the change in the
  repository instead; the switch and "also save" options are hidden there.
- Demo: the "proxy can't reach it" example moved from radarr to umami, a stack
  that isn't git-backed, so saving the fix stays demoable.

## v2.31.0 (2026-10-22)

Updates you can read, and a round of polish.

- **What kind of update is this?** The update tab and the Updates page now say it in
  plain words instead of showing two `sha256:` codes: the same pinned release
  rebuilt (usually security fixes, low risk), a newer release on a line tag like
  `5-alpine`, or `latest`, which can be anything. The digests moved into a fold.
- **Newer versions of pinned images.** An image pinned to `10.9.6` never heard
  about `10.10.3`, because the update check only sees rebuilds of the same tag.
  homeport now reads the registry's tag list (Docker Hub, GHCR, lscr.io, quay.io
  and others, anonymously or with your stored login) and lists newer versions on
  the Updates page, labelled patch, minor or major, safest first. A major jump
  also offers the newest release on your current major. Calendar versions (like
  Home Assistant's `2024.10.1`) are not treated as majors.
- **Switch versions in one click.** A stack's service gets the new tag written
  into its compose file (comments kept; tags set through a variable are left to
  you) and the stack is brought up; a standalone container is pulled and
  recreated with rollback. Major versions ask you to read the changelog and back
  up first.
- **Bug: updated containers kept the old image's settings.** Recreating a
  standalone container copied its whole config, including environment values that
  came from the old image (`PATH`, `NGINX_VERSION`, `PG_MAJOR`), so they overrode
  the new image's. Values that still match the old image's defaults are now
  dropped; your own settings are kept.
- **Domains page shows health.** Each route shows its HTTP status and response
  time, links its container (or says none matches), and shows the "proxy can't
  reach it" warning with its one-click fix.
- **Needs attention** now includes a running app whose domain answers an error or
  nothing at all, and the Issues filter lists exactly what that strip counts (it
  missed the "proxy can't reach it" items).
- **Bug: a git-backed stack hid its image updates.** The "Update stack" button
  was hidden on git stacks, but updating from git doesn't pull images. It now
  shows as "Update images (N)".
- **Phones:** tab strips show an edge hint when there are more tabs (with the
  update dot if a hidden tab has one) and keep the open tab in view; Settings
  sections wrap into pills instead of a strip that hid most of them; the
  dashboard filters fit the width; activity rows wrap instead of cutting off; a
  domain's status sits under it.
- Activity and the catalog detail pages share the left edge of every other page,
  so the header no longer jumps when switching.

## v2.30.0 (2026-10-22)

Networks that make sense, and a sweep for bugs.

- **Networks page, rebuilt around "who can reach whom".** Containers reach each
  other by name only on a shared network, so shared networks (like the reverse
  proxy's) come first, showing which stacks and containers each one connects.
  Every stack's private network and Docker's built-ins are folded away below, and
  subnets moved into the details.
- **Network connections that stick.** Connecting or disconnecting a stack's
  container also writes it into the compose file (keeping the service on its own
  stack network and declaring the shared one `external`), so the stack's next
  start no longer undoes it.
- **"The proxy can't reach this container."** homeport finds your reverse-proxy
  container and checks each domain routed to a container by name. If they share no
  network (the classic 502), the dashboard, the container page and the domain form
  say so, with one click to connect it to the proxy's network.
- **Bug: two operations on one container could leave a leftover.** An update and
  an environment change (or the nightly auto-update and a manual click) running
  at once raced on the container swap and could leave an `<name>-old-…` container
  behind. Swaps are now one at a time per container; the second gets a clear
  "busy" answer (HTTP 409).
- **Readability.** Secondary text, status colours, solid buttons and editor line
  numbers now meet WCAG AA contrast in both themes, links are underlined (not told
  apart by colour alone), and the code editors, network pickers, catalog install
  fields, API token and user account forms have proper labels. Settings locked by
  an environment variable keep their explanation readable instead of fading it
  out with the control.
- **Security updates.** Dependencies refreshed within their ranges: 35 audit
  findings down to 13, none critical (the Vue server-renderer XSS fix among them).
  What's left is dev-server and build tooling that doesn't ship in the image.
- Container pages say "Stack" instead of "Group"; demo data gains a proxy network
  with one app left off it, so the new warning has something to show.

## v2.29.0 (2026-10-22)

Stacks and containers, made one model. A **stack** is a docker compose project;
its **containers** are the running parts of it.

- **Dashboard groups are stacks.** Each group header shows the stack's real
  state and its actions: Start, Restart, Update, Stop (compose down). Containers
  started with plain `docker run` sit in "Standalone containers" (the old
  "Other"), systemd units in "Host services". A `hub.group` label still files a
  container under a custom group, marked as such.
- **Counted from the compose file.** A stack that was stopped (`down`) no longer
  vanishes from the dashboard, and a service that never got a container (a failed
  pull or start) shows as "Not running" instead of the stack claiming "3/3". Partly
  started stacks appear under Needs attention.
- **Container actions explain what the stack will do.** Stopping one container of a
  stack says it comes back on the stack's next start and offers "Stop the whole
  stack"; deleting one says the compose file still lists it and offers to open it.
  Container pages link to their stack ("Stack: media") and show its compose service.
- **One word per thing.** "Stack" instead of compose project, group or "Other";
  the Stacks page defines it, and "Unmanaged compose projects" is now "Stacks
  homeport can't edit".

## v2.28.0 (2026-10-22)

A complete UI makeover: new design system, clearer pages, and the pain points
found by using every page as a user.

- **New look throughout.** One design system (buttons, inputs, cards, badges,
  callouts) replaces per-page styling; Inter and JetBrains Mono ship with the
  image (no font CDN), and native checkboxes, selects and scrollbars now follow
  the light/dark theme instead of rendering white in dark mode.
- **Command palette.** <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> (or "Jump to…" in
  the sidebar) finds any container, stack or page by name.
- **Dashboard that scales.** Compact cards in a real grid (the old masonry made a
  14-container demo 2000px tall), a dense **list view**, status filters (running,
  stopped, issues, updates), a **Needs attention** strip for unhealthy, crash-looping
  and failed containers, collapse/expand all, and <kbd>/</kbd> to filter. Clicking a
  card opens its page; the update badge opens the Update tab directly.
- **Container page.** Breadcrumbs, an Open button for its domain, a two-column
  overview with labelled settings (the CPU and memory limit fields used to cut their
  own placeholders off), and tabs that live in the URL (`?tab=logs` survives a
  reload and can be shared). The usage graph now opens on the last hour of history:
  it never loaded stored history on open, so it always started empty.
- **Settings in categories.** Seven sections instead of one 4000px page. The save
  bar appears only when something changed, offers Discard, and leaving with unsaved
  changes asks first. Old `/settings#section` links still land in the right place.
- **Updates: "Update everything".** One confirmation updates every pending group in
  turn (managed stacks via compose, the rest recreated in place).
- **Storage: "Remove unused images".** Shows how much space is reclaimable and
  removes every unused image in one go. Volumes stay one-by-one on purpose: they
  hold data.
- **Stacks.** The operation log now appears right under the buttons that start it
  (it used to land below a tall editor, out of sight), services are listed above the
  compose editor, and <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> saves.
- **Command palette actions and keyboard shortcuts.** Type a container plus a verb
  ("jelly logs", "restart sonarr", "update vault") to act on it from
  <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>; <kbd>?</kbd> shows every shortcut and
  <kbd>G</kbd> then a letter jumps to a page (<kbd>G</kbd> <kbd>S</kbd> for Stacks).
- **Pin containers** to a group at the top of the dashboard (per browser).
- **Settings that stick.** On a homeport-managed stack, changing a container's
  restart policy or CPU/memory limits now also writes them into the compose file
  (comments and formatting kept, validated with `docker compose config`), so the
  next `compose up` no longer silently reverts them.
- **Nothing lost by accident.** Leaving the compose editor, a file editor, the
  Environment tab or Settings with unsaved edits asks first (closing the browser
  tab too). Deleting a stack together with its volumes now needs the stack name
  typed.
- **Dashboard.** Status filter, search and host live in the URL, so Back from a
  container page returns to the same view. Crash-looping containers count as
  issues, not as "Stopped". The browser tab title shows the number of problems.
  Card actions show up on keyboard focus and are always visible on touch screens.
- **Connection lost banner.** If homeport stops answering (restart, network), a
  banner says so instead of showing stale data as live, and clears itself on
  reconnect.
- **Discoverable features.** Pages behind a capability that is turned off stay in
  the sidebar marked "off" and explain how to switch them on, instead of
  vanishing. Viewer accounts no longer see start/stop buttons they can't use.
- **Labelled forms.** Every Settings field has a real label (placeholders
  disappear while typing); login defaults the username to `admin`, which now
  signs in as the main account.
- **Logs** highlight filter matches, can wrap or not, and pause when you scroll up
  with a "Latest" button to jump back.
- **Catalog.** Apps offered by several template sources appear once (the earlier
  source wins); the default order puts homeport's own curated apps first and the
  best name match first when searching; a search with no template result offers
  Docker Hub and GitHub instead.
- **Fixes found along the way.** "domains via Traefik" no longer shows when no
  proxy is configured (auto-detect's label fallback always reported itself, which
  also hid the no-proxy onboarding card); Activity entries link to their container
  or stack; a fresh install's graphs open on live data instead of an empty hour;
  focus stays inside open dialogs; copy buttons for container names, images and
  URLs.
- **Smaller fixes.** Catalog descriptions with raw markdown
  (`[Name](https://…) is a …`) now read as plain text; the logs slide-over closes on
  <kbd>Esc</kbd> and logs can be filtered; labelled login fields (the username
  placeholder was cut off); no back arrows on top-level pages; header buttons no
  longer wrap; the container page no longer overflows on phones.
- **`HOMEPORT_BIND` limits which host address the port is published on.** Set
  `HOMEPORT_BIND=127.0.0.1` in `.env` once a reverse proxy fronts homeport: Docker
  publishes ports past ufw/firewalld, so the default leaves `:3004` reachable from
  the internet over plain HTTP. Unset keeps the old binding (every interface, IPv4
  and IPv6). Compose files only, no new image needed.

## v2.27.2 , 2026-08-05

Fix: self-update no longer takes down its own socket proxy.

- **"Update homeport" could leave the stack half-recreated.** The updater ran
  `compose up -d` for the WHOLE project, so it also recreated homeport's
  `docker-socket-proxy` sibling, which is the very thing it reaches the Docker
  daemon through. Stopping it severed the updater's own connection mid-run
  (`error during connect: ... EOF`), leaving the proxy down, a half-created
  replacement behind, and homeport running but blind to Docker. The updater now
  targets homeport's own compose service only (`pull <service>` and
  `up -d --no-deps <service>`), so siblings are left alone. Recovery for an
  instance already in that state: `docker compose up -d` in the homeport
  project dir, from the host shell.

## v2.27.1 — 2026-08-05

Fix: private images now pull inside stacks too.

- **Stack `pull` / `up` no longer fails with `unauthorized` on private images.**
  Registry credentials from Settings were only used for update checks and
  single-container updates, which talk to the registry through the Docker API.
  Stack operations shell out to the compose CLI, which reads logins from a
  `config.json` and had none — so `docker compose pull` of a private
  `ghcr.io` image 401'd even with a valid token saved. Compose now runs with a
  `DOCKER_CONFIG` written from those same credentials.

## v2.27.0 — 2026-07-10

Updating, apps, and stacks — made clearer.

- **Update a whole stack in one click.** Managed stacks now show a clear
  **"Update stack (N)"** button when their services have newer images (pulls and
  recreates the whole project), and each stack in the list carries an **"N
  updates"** badge. No more guessing that "Pull & up" was the update — that stays
  as an advanced action.
- **homeport tells you when *it* has an update.** A new **"Update homeport"**
  indicator appears in the sidebar the moment a newer image is available, with a
  one-click update — instead of being buried in Settings with no signal. Settings
  → About shows the same "update available" state, and the flow is now shared so
  the two never disagree.
- **Apps and Stacks are connected.** The Catalog marks apps you've **already
  installed** with a badge, and an app's page links straight to **its stack**
  ("an installed app is just a stack"). Stacks gains an **"Install an app"** link
  to the Catalog. Same features, one mental model.

## v2.26.1 — 2026-07-10

Fix for a bind mount whose files homeport can't see on disk.

- **Stack files: no more raw `ENOENT` on a bind mount homeport can't read.** When
  the stacks directory is a named volume (rather than a same-path host mount), a
  container's relative bind (e.g. SearXNG's `./searxng:/etc/searxng`) is created
  by Docker on the host, outside homeport's view — so trying to open that folder
  in the file browser threw `ENOENT: … scandir …`. "Data & mounts" now detects
  whether homeport can actually read a bind and, when it can't, routes that row to
  the **container file editor** (which reads it inside the container via
  `docker cp`) instead of a dead "open" link. The file browser also explains the
  situation instead of surfacing the raw error.

## v2.26.0 — 2026-07-10

Stacks quality-of-life: a cleaner delete, and — finally — a way to see and edit
the files an installed app actually keeps, wherever they live.

- **Deleting a stack no longer leaves you stranded.** The page now navigates back
  to the stacks list as soon as the stack is actually gone, even when the live
  operation stream drops mid-delete (it re-checks server-side instead of waiting
  on a stream event that may never arrive). No more "did that work?" refresh.
- **"Data & mounts" on every stack.** A new section shows where each service
  keeps its files — config living in the stack folder (editable in the file
  browser, one click away), named volumes (linked to Storage), and external host
  paths (with a read-only/read-write badge). Installing an app no longer hides
  its data: you can see exactly what's a volume and what's a bind.
- **Edit files inside containers and volumes.** Opt-in
  (`HOMEPORT_ALLOW_CONTAINER_FILES`, off by default), this reaches config that
  lives in a **named volume** rather than the compose file — the common case for
  apps installed from a Docker Hub image (e.g. SearXNG's `/etc/searxng`). Browse
  and edit right from a mount's **browse** button. It works via `docker cp`, so
  no shell is needed in the container and even stopped or distroless containers
  are editable. Read-only mounts are view-only, viewers are blocked entirely
  (container files can hold secrets), and path traversal is guarded. Needs the
  socket proxy to allow `PUT` on `/containers/*/archive` (the same `POST: 1` that
  Stacks/terminal already use) — Settings → "Probe proxy permissions" now checks
  it for you and shows red if it's blocked.

## v2.25.0 — 2026-07-09

Multi-user access, live resource-limit editing, and installable-app support —
the last of the "yeah, but it can't even…" gaps.

- **Multi-user + read-only viewer role.** Share the dashboard with a
  partner/household without handing over management. The admin creates viewer
  accounts (Settings → Accounts) with their own username + password; a
  viewer's session cookie carries only an opaque account id, never a baked-in
  role, so access is re-checked fresh on every request and deleting the
  account revokes it instantly. Enforcement is entirely server-side — a
  viewer's requests are restricted to `GET`/`HEAD`, and `/api/backup`,
  `/api/users`, `/api/tokens`, and `/api/totp` are blocked outright — the UI
  hiding mutating controls to match is a convenience, not the boundary. A
  post-ship adversarial security review (4-reviewer audit + independent
  verify pass) found and fixed four issues before this shipped: two read-deny
  gaps (`/api/tokens`, `/api/totp` were reachable by a viewer), a shared
  brute-force bucket that let a mistyped viewer password lock out the admin
  from the same IP (now separate per-credential limiters), a few UI
  inconsistencies that left mutating buttons visible-but-403 for viewers, and
  a timing side-channel in login that could be used to enumerate valid
  usernames.
- **Container resource-limit editing (CPU + memory).** Set CPU cores and
  memory limits on a running container straight from its service page, no
  recreate needed — the same live-update mechanism the existing restart-policy
  editor uses. Compose-managed containers are flagged, since the compose
  file's own `deploy.resources`/`mem_limit` wins on the next recreate.
  Clearing a limit back to "unset" isn't possible through a live update (the
  Docker Engine API has no way to express that short of recreating the
  container) — homeport says so plainly instead of failing silently.
- **Installable as an app (PWA).** A web manifest and offline-cache service
  worker mean the dashboard can be added to a phone or tablet home screen and
  opened like a native app.
- **Changelog links on the Updates view.** Where an image's registry and repo
  can be confidently mapped to its GitHub releases page, an available update
  now links straight to the changelog instead of leaving you to go find it.

## v2.23.0 — 2026-07-07

Public-launch prep: one-command install, security hardening, and installing a
reverse proxy from the app.

- **One-command install (`install.sh`).** A fresh server now goes from nothing to
  homeport running with a single command — it **installs Docker + the Compose
  plugin if they're missing** (via the official get.docker.com script, with a
  confirmation prompt), creates the shared reverse-proxy network (the classic
  first-run failure), fetches the hardened compose setup, generates a session
  secret, and starts it. Idempotent and safe to re-run; the script is inspectable
  (download-then-run is documented). The compose file's placeholder proxy mount is
  commented out by default so a first `up` just works.
- **Install a reverse proxy from the app — and connect it in one click.** The app
  catalog now ships **Nginx Proxy Manager** as a curated one-click install (wired
  onto the shared network so homeport can reach its API). A getting-started card on
  the dashboard installs it and then **auto-connects**: homeport waits for NPM to
  come up, rotates its default password to a generated one, stores the credentials,
  and turns proxy management on — so you can add domains immediately, no manual
  setup. Bare box → services on real domains, entirely from the UI.
- **First-run wizard.** After you set your admin password, a short three-step
  wizard orients you (homeport is read-only by default), offers to install and
  connect a reverse proxy, and lets you opt into management capabilities — then
  drops you on the dashboard. Skippable at every step.
- **Security hardening.** The login brute-force limiter no longer trusts a
  spoofable `X-Forwarded-For` unless you opt in with `HOMEPORT_TRUSTED_PROXY`, and
  a rotation-proof global ceiling backstops it; the minimum password length is now
  10 (a short env-set password is warned about at boot). Logging out and changing
  your password now **revoke existing sessions** (previously a cookie stayed valid
  for its full 30-day life). A read-only data volume no longer silently disables
  the login — it fails closed unless you set `HOMEPORT_ALLOW_OPEN=true`.
- **Repo polish.** README badges, a table of contents, a "how it compares" table,
  and a `.dockerignore` (keeps deps and local files out of the build context).

## v2.22.0 — 2026-07-06

Error logging + clarity pass — make failures visible and every flow legible.

- **Server-side logging.** homeport now writes leveled, tagged diagnostics to the
  container log (`docker logs homeport`) — it previously logged nothing at all.
  A boot banner states the effective config (version, auth mode, data-dir
  writability, docker target, collector cadence, enabled capabilities). Every
  background-loop failure is logged instead of silently swallowed: collector
  ticks (now stage-isolated, so one broken subsystem can't take down history +
  alerts together), auto-update / update-sweep host skips and results, the
  docker events reconnect loop, failed alert deliveries, and self-update. When
  the data dir is read-only, a one-time warning explains why history / sessions
  won't persist. Level via `HOMEPORT_LOG_LEVEL` (debug|info|warn|error|silent,
  default info); secrets are redacted.
- **Clearer error messages.** Reverse-proxy (NPM/Caddy) failures keep the
  upstream reason instead of a bare `HTTP 401`, and connection refused / host
  not found read plainly. Auto-dockerize image inspection gives a distinct
  message for private/nonexistent images vs timeouts. A failed update that rolls
  back now says the previous version is running again — and a failed rollback
  says the service is down and names the leftover container. Container-control
  errors map to the right status and hint when the socket-proxy needs `POST=1`.
- **No more dead-ends in the UI.** The log viewer shows a connection state +
  Reconnect instead of an eternal spinner when the stream drops. Operation
  panels no longer flash a red "failed" when the browser merely loses the SSE
  stream mid-run — they say the operation may still be running. A transient
  capabilities fetch is retried instead of silently hiding the whole sidebar,
  and the dashboard shows "stats paused" when the stats poll keeps failing.
- **Native dialogs replaced.** Every `window.confirm` / `window.alert` (which are
  silently suppressed in embedded/proxied views — a button that looked dead)
  is now a themed in-app confirm dialog and toast, rendered in the DOM.

## v2.21.0 — 2026-07-06

- **Catalog Hub & GitHub tabs open with a recommended list.** The Docker Hub
  tab lands on the most-pulled official images; the GitHub tab lands on the
  most-starred self-hosted projects — no more blank tab that hides the fact
  it's searchable. Both got a prominent search hero (icon, wide input, clear
  button) with search-as-you-type; clearing the box returns to the popular
  list.
- **Auto-dockerize any Docker Hub image.** Picking an image opens a guided
  install page that reads the image's own configuration from the registry —
  the ports it EXPOSEs and the paths it stores data in — and prepares a compose
  stack from them (data paths become named volumes so recreates keep them).
  Adjust ports/volumes, then install; the result is a normal editable stack.
- **Auto-dockerize GitHub repos without a compose file.** Deploying a repo that
  ships only a Dockerfile now generates a build-in-place `compose.yaml` (ports
  from `EXPOSE`) instead of failing. The generated file is untracked, so git
  updates leave it in place. (Building through a docker-socket-proxy needs
  `BUILD=1`.)

## v2.20.0 — 2026-07-06

- **Storage page.** /storage lists every volume and image with what references
  it — the place where data that outlived a deleted stack or container becomes
  visible (deletes keep volumes by default). Unused volumes are removable with
  a two-step confirm (that data is gone forever); unused/dangling images too
  (those just cost a re-pull). Volume disk usage on demand via
  `docker system df`. Compose-project chips show where each volume came from.
- **Live graphs render instantly.** An empty live buffer seeds itself with the
  first sample doubled, so graphs and sparklines draw on the first poll instead
  of waiting a full interval (~7s) for a second point.

## v2.19.0 — 2026-07-06

- **File browser per stack.** Every stack page (including external/adopted
  projects) gets a Files section over the stack's own directory: browse,
  create, edit (CodeMirror, YAML highlighting where it applies), rename,
  delete, upload, and download. `.env` and config files land next to the
  compose file, exactly where compose expects them — so "set the API key
  before first start" is now an in-app flow. Overwritten files keep a `.bak`.
  Guard rails: paths are validated against traversal *and* symlink escapes
  (realpath containment), `.git` internals are off limits, the compose file
  can't be deleted/renamed and is compose-validated on save (bad saves are
  rolled back), binary/oversized files are download-only, uploads capped at
  50 MiB.

## v2.18.0 — 2026-07-06

- **Create networks and attach/detach containers.** The /networks page can now
  create a bridge network (optional fixed subnet, validated against existing
  ranges up front — a conflict names the network instead of failing with the
  daemon's bare "Pool overlaps") and attach or detach containers per network.
  Detaching a container's last network is refused (it would become
  unreachable). The page is honest about docker's rules: memberships are
  runtime-only for compose-managed containers (the compose file wins on the
  next recreate — use `external: true` there to make it stick), and subnets
  cannot be edited in place.

## v2.17.0 — 2026-07-06

- **Networks manager.** New **/networks** page: every docker network with its
  subnets, driver, compose project, and attached containers (linked); unused
  networks removable with one click (built-ins and referenced networks are
  refused). Service pages show the networks each container joins.
- **Delete things completely.** Deletes stay conservative by default, with
  opt-in checkboxes for a full cleanup:
  - Stack delete: also remove named volumes (`down --volumes`), images
    (`--rmi all`), and the stack's reverse-proxy domains. Leftover project
    networks are swept always — unused networks keep their subnet claimed and
    caused real "Pool overlaps" failures on reinstall.
  - Container delete: also remove its image and its proxy routes (matching
    domains are shown before confirming); cleanup results are reported
    step-by-step.

## v2.16.0 — 2026-07-06

- **Manage compose projects wherever they live.** Projects started outside
  homeport no longer have to move into the stacks dir:
  - Running compose projects whose files are visible inside the container
    (mount them at the **same path** they have on the host, e.g.
    `-v /home/user/docker:/home/user/docker`) are **adopted automatically** —
    edited and compose-operated in place, marked `external` in the UI.
  - **Settings → Compose roots** (`HOMEPORT_COMPOSE_ROOTS`) scans extra
    directories for compose projects — including ones whose containers were
    **never created**, so you can set env vars and deploy a fresh project from
    homeport instead of over SSH.
  - Projects homeport can't see stay "unmanaged"; the stacks page now shows the
    exact host path to mount to adopt each one.
  - Safety: external stacks can't be deleted from homeport, and homeport
    refuses `down`/`restart`/`pull` on its **own** stack (that would kill it
    mid-operation) — self-updates go through Settings → About.
- **"Pool overlaps" deploy failures are now diagnosed and fixable in-app.**
  When a stack deploy dies on docker's address-space errors, homeport compares
  the subnets the stack requests with the live network list and names the
  conflicting network in the op output. The stack page adds a card listing all
  docker networks (subnet, container count) with one-click **removal of unused
  networks** and a retry button. New `GET /api/networks` +
  `POST /api/networks/remove` (stacks-gated; removal refuses built-ins and
  anything still referenced by a container).

## v2.15.0 — 2026-07-06

- Re-cut of **v2.14.0** (private registry logins, below) — its release run hung
  building multi-arch images under QEMU. The publish workflow now uses native
  per-arch runners and merges the digests into one manifest, so this is the
  version that actually ships to GHCR. No application changes since v2.14.0.

## v2.14.0 — 2026-07-06

- **Private registry logins.** homeport can now check *and* update private
  images (e.g. your own `ghcr.io` packages) — previously every check went out
  anonymously and private images failed with a `401`. Add a registry / username
  / token under **Settings → Registry credentials** (shown once an update
  capability is on), or set `HOMEPORT_REGISTRY_AUTH=ghcr.io=user:token,…`. The
  matching login is sent as `X-Registry-Auth` on both the daemon digest check
  and the pull during an apply. A GHCR token needs `read:packages` to check,
  `write:packages` to also apply. Tokens live in `settings.json` on the data
  volume (same as the other secrets) — include it in your backups' safekeeping.

## v2.13.1 — 2026-07-05

- **Fix: untagged images no longer break update checks.** A container whose
  image lost its tag (a manual `docker pull` moved `:latest` and the old tag
  was pruned — the daemon then reports a bare `sha256:` id) has no repository
  to query; it's now treated as locally-built instead of erroring every sweep.
- Registry 401s during update checks get an actionable message (private
  package / wrong reference) instead of raw daemon output.

## v2.13.0 — 2026-07-05

- **GitHub in the catalog**: alongside Docker Hub, a GitHub tab searches all of
  GitHub (sortable by stars) and deploys any repository with a compose file at
  its root as a **git-backed stack** in one click — the from-git form opens
  prefilled, and future updates arrive with the existing one-click stack update.

## v2.12.0 — 2026-07-05

- **Delete and recreate containers**: every container page gets a danger zone —
  recreate-in-place (same image and settings, for wedged containers) and delete,
  with an opt-in for removing anonymous volumes. Managed-stack containers get an
  honest note that the stack's next `up` brings them back.
- **Delete stacks**: managed stacks get a Delete action — `compose down`, then
  the stack directory (and its git token) is removed, streamed live like every
  other stack operation. Named volumes are always kept.
- **Docker Hub in the catalog**: a new Hub tab searches all of Docker Hub with
  pull/star counts (sortable by either) and official-image badges — one click
  turns any image into a new compose stack with the editor prefilled.

## v2.11.0 — 2026-07-05

- **CI and release automation**: every push and PR runs tests, the production
  build and a full-page smoke test in GitHub Actions; pushing a `v*` tag now
  builds the multi-arch image, publishes it to GHCR and creates the GitHub
  Release from this changelog — no manual publishing steps left.
- **Smoke test** (`npm run smoke`): boots the built app in demo mode, logs in,
  visits every page and clicks through every service tab, failing on any page
  error, console error or 5xx.
- **Activity page**: one chronological feed of everything that happened —
  service state changes, update notifications, auto-update results and server
  operations — filterable, in the sidebar.

## v2.10.0 — 2026-07-05

- **Email (SMTP) alert channel**: alerts (and update notifications) can go to
  email alongside webhooks — implicit TLS (465) or STARTTLS (587), optional
  auth, multiple recipients, covered by the Send-test button. Configured
  entirely in Settings → Alerts; a deliberately tiny built-in SMTP client, no
  new dependencies.
- **Docs**: README rewritten to cover everything since v2.4.0 — the Updates
  view, scheduled auto-update (+ `hub.autoupdate` label), environment editor,
  backup & restore, capability probe, login rate-limiting — with fresh
  screenshots.

## v2.9.0 — 2026-07-05

- **Backup & restore** (Settings → Backup): one JSON file with everything
  homeport persists — settings, hosts, alert channels, proxy credentials, the
  admin password hash and stack git tokens. Restoring replaces settings
  wholesale; treat the file like a password, it contains secrets.
- **Environment editor**: a new Environment tab on every container page (needs
  the updates capability). Edit, add or delete variables and apply — the
  container is recreated in place with the same image and settings, and the
  page follows it to its new id. Secret-looking values are write-only: you can
  replace them but never read them back. Managed-stack containers are pointed
  at their compose file instead; unmanaged compose containers get an honest
  warning that a future `compose up` from the original file wins.
- **Catalog polish**: search/category/sort/page live in the URL (shareable,
  survives refresh and back), a sort control (source order / name), inline
  validation on the install form, and after a successful install the catalog
  follows the app to its new service page as soon as it comes up.

## v2.8.0 — 2026-07-05

- **Scheduled automatic updates** (opt-in). Once a day, in an hour you pick,
  homeport applies pending image updates to everything opted in: managed stacks
  via `compose pull && up`, other containers via pull + recreate. Opt in per
  stack/container with one-click "auto" toggles on the Updates page, the target
  list in Settings → Auto-update, or a `hub.autoupdate=true` container label
  (`=false` always opts out). homeport itself is always skipped. Every applied
  (or failed) update is pushed through your alert channels and logged.

## v2.7.0 — 2026-07-05

- **Update notifications**: when the update sweep finds a newer image, homeport
  can push it through your existing alert channels (Discord / Slack / ntfy /
  webhook) — one message per new digest, never repeated on later sweeps.
  Opt-in: Settings → Alerts → "Notify when image updates are found".
- **Event stream self-heals**: if the Docker events feed dies (socket-proxy
  restart, host blip), homeport now reattaches with backoff and refreshes the
  dashboard on recovery, instead of silently going stale until the next poll.
- **Login rate-limiting**: 5 free attempts per client, then escalating lockouts
  (30s doubling up to 15min, HTTP 429 with the wait time) plus a flat delay on
  every wrong guess.

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
