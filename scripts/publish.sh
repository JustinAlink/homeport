#!/usr/bin/env bash
# Build and publish the homeport image to a container registry WITHOUT GitHub
# Actions — a single command you run from your machine (or any CI you like).
#
# Usage:
#   GHCR_OWNER=yourname ./scripts/publish.sh            # → ghcr.io/yourname/homeport:latest
#   GHCR_OWNER=yourname ./scripts/publish.sh v0.3.0     # tag as v0.3.0
#
# Environment:
#   GHCR_OWNER  (required) your GitHub username/org — lowercased automatically
#   IMAGE_TAG   tag to publish (default: latest; the positional arg overrides it)
#   REGISTRY    registry host (default: ghcr.io)
#   PLATFORMS   if set (e.g. "linux/amd64,linux/arm64"), build multi-arch via buildx
#
# First, log in once (GHCR needs a PAT with write:packages):
#   echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USER --password-stdin
set -euo pipefail

REGISTRY="${REGISTRY:-ghcr.io}"
OWNER="${GHCR_OWNER:-}"
TAG="${1:-${IMAGE_TAG:-latest}}"

if [ -z "$OWNER" ]; then
  echo "error: set GHCR_OWNER to your GitHub username/org (lowercase)." >&2
  echo "  e.g. GHCR_OWNER=yourname ./scripts/publish.sh" >&2
  exit 1
fi

OWNER="$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')"
IMAGE="${REGISTRY}/${OWNER}/homeport:${TAG}"

cd "$(dirname "$0")/.."

if ! docker system info >/dev/null 2>&1; then
  echo "error: docker is not available / not running." >&2
  exit 1
fi

# Also publish :latest when a version tag is given (the install commands use :latest).
LATEST="${REGISTRY}/${OWNER}/homeport:latest"
TAGS=("$IMAGE")
[ "$TAG" != "latest" ] && TAGS+=("$LATEST")

echo "→ Building ${IMAGE}"
if [ -n "${PLATFORMS:-}" ]; then
  echo "  (multi-arch: ${PLATFORMS})"
  TAG_ARGS=(); for t in "${TAGS[@]}"; do TAG_ARGS+=(-t "$t"); done
  docker buildx build --platform "$PLATFORMS" "${TAG_ARGS[@]}" --push .
else
  TAG_ARGS=(); for t in "${TAGS[@]}"; do TAG_ARGS+=(-t "$t"); done
  docker build "${TAG_ARGS[@]}" .
  for t in "${TAGS[@]}"; do
    echo "→ Pushing ${t}"
    docker push "$t"
  done
fi

echo "✓ Published: ${TAGS[*]}"
echo
echo "Deploy on the host:"
echo "  export GHCR_OWNER=${OWNER}${TAG:+ IMAGE_TAG=${TAG}}"
echo "  docker compose pull && docker compose up -d"
