#!/usr/bin/env bash
# Deploys one service to the new image tag, with automatic rollback.
# Called by GitHub Actions over SSH; can also be run by hand on the server:
#
#   ./deploy.sh api <tag>     # e.g. ./deploy.sh api 3f2c1ab   (a git commit SHA)
#   ./deploy.sh web <tag>
#   SKIP_PULL=1 ./deploy.sh api <tag>   # use an image already on this machine
#
# For the API it first takes a database backup, then runs migrations.
# If the new container isn't healthy within ~2 minutes, the previous tag is
# put back. (Database migrations are not undone — keep them backward
# compatible: add columns first, remove old ones in a later release.)
set -euo pipefail
cd "$(dirname "$0")"

SERVICE="${1:?usage: deploy.sh <api|web> <tag>}"
TAG="${2:?usage: deploy.sh <api|web> <tag>}"
case "$SERVICE" in
  api) VAR=API_TAG ;;
  web) VAR=WEB_TAG ;;
  *) echo "Unknown service: $SERVICE (expected api or web)" >&2; exit 2 ;;
esac

# The web and API repos deploy independently; queue them so two deploys
# never edit tags.env or restart containers at the same time.
if command -v flock >/dev/null; then
  exec 9>.deploy.lock
  flock -w 900 9 || { echo "Another deploy is still running" >&2; exit 1; }
fi

touch tags.env
PREVIOUS="$(grep -E "^${VAR}=" tags.env | cut -d= -f2 || true)"

set_tag() {
  if grep -qE "^${VAR}=" tags.env; then
    sed -i "s/^${VAR}=.*/${VAR}=$1/" tags.env
  else
    echo "${VAR}=$1" >> tags.env
  fi
}

# Tags from tags.env override the defaults in docker-compose.yml.
compose() {
  set -a
  # shellcheck disable=SC1091
  . ./tags.env
  set +a
  docker compose "$@"
}

wait_healthy() {
  local id status
  for _ in $(seq 1 60); do
    id="$(compose ps -q "$SERVICE")"
    status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)"
    [ "$status" = "healthy" ] && return 0
    [ "$status" = "unhealthy" ] && return 1
    sleep 2
  done
  return 1
}

echo "==> Deploying $SERVICE: ${PREVIOUS:-none} -> $TAG"
set_tag "$TAG"
if [ "${SKIP_PULL:-0}" != "1" ]; then
  compose pull "$SERVICE"
fi

if [ "$SERVICE" = "api" ]; then
  # --wait: on a fresh server Postgres needs a few seconds before it accepts
  # connections; backup and migrations must not start earlier.
  compose up -d --wait db
  echo "==> Backup before migrating"
  ./backup.sh pre-deploy
  echo "==> Running database migrations"
  compose run --rm --no-deps api node_modules/.bin/prisma migrate deploy
fi

compose up -d --no-deps "$SERVICE"

if wait_healthy; then
  # --no-deps: the first API deploy must not try to start (pull) the web
  # image before the frontend has ever been deployed.
  compose up -d --no-deps caddy
  docker image prune -f >/dev/null
  echo "==> $SERVICE is healthy on $TAG"
else
  echo "!!  $SERVICE did not become healthy on $TAG" >&2
  compose logs --tail 80 "$SERVICE" >&2 || true
  if [ -n "$PREVIOUS" ]; then
    echo "==> Rolling back $SERVICE to $PREVIOUS" >&2
    set_tag "$PREVIOUS"
    compose up -d --no-deps "$SERVICE"
  fi
  exit 1
fi
