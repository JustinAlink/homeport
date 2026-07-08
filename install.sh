#!/bin/sh
# homeport installer — https://github.com/JustinAlink/homeport
#
# Turns a fresh server into a running homeport in one command:
#   • installs Docker + the Compose plugin if they're missing (opt-in prompt)
#   • creates the shared reverse-proxy network (the classic first-run failure)
#   • fetches the hardened compose setup, generates a session secret, starts it
# Idempotent — safe to re-run.
#
# Review it first:
#   curl -fsSLO https://raw.githubusercontent.com/JustinAlink/homeport/main/install.sh
#   less install.sh
#   sh install.sh
#
# Or run it directly:
#   curl -fsSL https://raw.githubusercontent.com/JustinAlink/homeport/main/install.sh | sh
#
# Env overrides: HOMEPORT_DIR (install dir), HOMEPORT_REF (git ref), HOMEPORT_PORT,
#   HOMEPORT_INSTALL_DOCKER=1|0 (skip the "install Docker?" prompt either way).

set -eu

REPO="JustinAlink/homeport"
REF="${HOMEPORT_REF:-main}"
RAW="https://raw.githubusercontent.com/$REPO/$REF"
DIR="${HOMEPORT_DIR:-./homeport}"
PORT="${HOMEPORT_PORT:-3004}"
NETWORK="npm-network"
DOCKER_JUST_INSTALLED=0

# --- tiny output helpers ---
if [ -t 1 ]; then B="$(printf '\033[1m')"; G="$(printf '\033[32m')"; Y="$(printf '\033[33m')"; R="$(printf '\033[31m')"; Z="$(printf '\033[0m')"; else B=""; G=""; Y=""; R=""; Z=""; fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$G" "$Z" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$Z" "$*"; }
die()  { printf '%s✗ %s%s\n' "$R" "$*" "$Z" >&2; exit 1; }

# Run privileged commands as root when we aren't already.
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# How we invoke docker for this run — becomes "sudo docker" if the daemon is
# only reachable as root (e.g. right after install, before a group re-login).
DK="docker"

fetch() { # url dest
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else die "need curl or wget to download files"; fi
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; fi
}

# Yes/no prompt. Reads from /dev/tty so it works even under `curl | sh`.
# Returns 1 (no) when there's no terminal — callers pair it with an env override.
ask() { # question
  [ -r /dev/tty ] || return 1
  printf '%s%s [Y/n]%s ' "$Y" "$1" "$Z" > /dev/tty
  read -r ans < /dev/tty || return 1
  case "$ans" in [nN]*) return 1 ;; *) return 0 ;; esac
}

pick_docker_invocation() {
  if docker info >/dev/null 2>&1; then DK="docker"; return 0; fi
  if [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then DK="$SUDO docker"; return 0; fi
  return 1
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    if ! docker info >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
      $SUDO systemctl start docker >/dev/null 2>&1 || true
    fi
    if pick_docker_invocation; then
      $DK compose version >/dev/null 2>&1 && { ok "Docker and Compose are ready"; return; }
      die "Docker is installed but the Compose v2 plugin is missing — install 'docker-compose-plugin' (or reinstall via https://get.docker.com) and re-run."
    fi
    die "Docker is installed but its daemon isn't reachable — start it ('sudo systemctl start docker') and re-run."
  fi

  # Docker not installed.
  say "Docker isn't installed — it's the one thing homeport needs underneath."
  want=0
  case "${HOMEPORT_INSTALL_DOCKER:-}" in
    1 | true | yes | y) want=1 ;;
    0 | false | no | n) want=0 ;;
    *) ask "Install Docker now via the official get.docker.com script (needs root)?" && want=1 ;;
  esac
  [ "$want" -eq 1 ] || die "Install Docker first: https://docs.docker.com/engine/install/  (or re-run with HOMEPORT_INSTALL_DOCKER=1)"

  if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then
    die "Installing Docker needs root, but 'sudo' isn't available. Run this script as root or install Docker manually."
  fi

  say "Installing Docker (this can take a minute)…"
  tmp="$(mktemp 2>/dev/null || echo /tmp/get-docker.$$.sh)"
  fetch "https://get.docker.com" "$tmp"
  $SUDO sh "$tmp"
  rm -f "$tmp"

  command -v docker >/dev/null 2>&1 || die "Docker installation didn't complete — see the output above."
  if command -v systemctl >/dev/null 2>&1; then $SUDO systemctl enable --now docker >/dev/null 2>&1 || true; fi

  # Let the invoking user run docker without sudo (takes effect at their next login).
  real_user="${SUDO_USER:-$(id -un)}"
  [ "$real_user" = "root" ] || $SUDO usermod -aG docker "$real_user" >/dev/null 2>&1 || true

  pick_docker_invocation || die "Docker installed but the daemon isn't reachable — try 'sudo systemctl start docker' and re-run."
  $DK compose version >/dev/null 2>&1 || die "Docker installed but the Compose plugin is missing — reinstall via https://get.docker.com."
  ok "Docker installed and running"
  DOCKER_JUST_INSTALLED=1
}

main() {
  say "${B}⚓ homeport installer${Z}"
  say ""

  # 1. Docker (install if missing) ------------------------------------------
  ensure_docker

  # 2. Reverse-proxy network (the classic first-run failure) -----------------
  # docker-compose.yml joins an external '$NETWORK' so a reverse proxy can reach
  # homeport by name. Create it up front so 'compose up' doesn't fail.
  if $DK network inspect "$NETWORK" >/dev/null 2>&1; then
    ok "docker network '$NETWORK' already exists"
  else
    $DK network create "$NETWORK" >/dev/null
    ok "created docker network '$NETWORK'"
  fi

  # 3. Install dir + compose file -------------------------------------------
  mkdir -p "$DIR"
  # The published host port now comes from HOMEPORT_PORT in .env. Older installs
  # hardcoded it in docker-compose.yml, so capture any custom value before we
  # overwrite the file — otherwise re-running would silently reset it to 3004.
  migrate_port=""
  if [ -f "$DIR/docker-compose.yml" ] && [ -f "$DIR/.env" ] && ! grep -q '^HOMEPORT_PORT=' "$DIR/.env"; then
    migrate_port="$(sed -n 's/.*"\([0-9]\{1,5\}\):3000".*/\1/p' "$DIR/docker-compose.yml" | head -n1)"
  fi
  fetch "$RAW/docker-compose.yml" "$DIR/docker-compose.yml"
  ok "fetched docker-compose.yml into $DIR"

  # 4. .env — generate a session secret, never clobber an existing one -------
  if [ -f "$DIR/.env" ]; then
    ok "kept your existing $DIR/.env"
    if [ -n "$migrate_port" ] && [ "$migrate_port" != "3004" ]; then
      printf 'HOMEPORT_PORT=%s\n' "$migrate_port" >> "$DIR/.env"
      ok "kept your custom host port ($migrate_port) — moved it to HOMEPORT_PORT in .env"
    fi
  else
    fetch "$RAW/.env.example" "$DIR/.env"
    printf '\n# --- generated by install.sh ---\nHOMEPORT_SESSION_SECRET=%s\nHOMEPORT_PORT=%s\n' "$(gen_secret)" "$PORT" >> "$DIR/.env"
    ok "wrote $DIR/.env with a fresh session secret"
    say "  (leave HOMEPORT_ADMIN_PASSWORD unset — you'll set your password in the browser on first run)"
  fi

  # Make the URL we print match what compose will actually publish. Compose reads
  # HOMEPORT_PORT from the shell env FIRST (already captured in $PORT), then .env.
  # So only fall back to the .env value when this run didn't set it in the env.
  if [ -z "${HOMEPORT_PORT:-}" ]; then
    env_port="$(sed -n 's/^HOMEPORT_PORT=\([0-9]\{1,5\}\).*/\1/p' "$DIR/.env" | tail -n1)"
    [ -n "$env_port" ] && PORT="$env_port"
  fi

  # 5. Up --------------------------------------------------------------------
  say ""
  say "Starting homeport…"
  ( cd "$DIR" && $DK compose up -d )

  # Wait until the server actually answers — the container is created before Nitro
  # is listening, and a "connection refused" on a slow/ARM box looks like a failure.
  ready=0
  printf '   waiting for homeport to answer'
  i=0
  while [ "$i" -lt 40 ]; do
    if command -v curl >/dev/null 2>&1; then
      curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && { ready=1; break; }
    elif command -v wget >/dev/null 2>&1; then
      wget -q -O /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && { ready=1; break; }
    else
      break # no http client to probe with — skip the wait
    fi
    i=$((i + 1))
    printf '.'
    sleep 1
  done
  printf '\n'

  # 6. Where to go next ------------------------------------------------------
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "${ip:-}" ] || ip="localhost"
  say ""
  if [ "$ready" -eq 1 ]; then
    say "${G}${B}✅ homeport is up!${Z}"
  else
    say "${Y}${B}homeport is starting${Z} — it hasn't answered yet, which can be normal on a slow box."
    say "   Watch it come up:  cd $DIR  &&  docker compose logs -f"
  fi
  say ""
  say "   Open  ${B}http://$ip:$PORT${Z}  and create your admin password."
  say ""
  say "   Next steps:"
  say "   • Put it behind a reverse proxy with a real domain + HTTPS (don't expose $PORT to the internet)."
  say "   • No reverse proxy yet? homeport can install and manage one for you — from the app."
  say "   • Manage it later:  cd $DIR  &&  docker compose pull && docker compose up -d"
  if [ "$DOCKER_JUST_INSTALLED" -eq 1 ]; then
    say ""
    warn "Docker was just installed and added you to the 'docker' group — log out and back in"
    warn "  (or run 'newgrp docker') to use docker without sudo."
  fi
  say ""
  say "   Docs: https://github.com/$REPO#readme"
}

main "$@"
