#!/usr/bin/env sh
# Nashriyar — atomic deploy & rollback script for self-hosted servers (ROADMAP phase 11).
# Usage on the server (in /opt/nashriyar):
#   ./deploy/deploy.sh                 deploy origin/main (takes DB backup, records previous commit, healthchecks, auto-rollbacks on failure)
#   ./deploy/deploy.sh v1.2.0          deploy a specific tag/commit
#   ./deploy/deploy.sh --rollback      revert to the previously recorded working commit (.last-good-rev)
set -eu

APP_DIR="${APP_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT:-3000}/healthz}"
STATE_FILE="$APP_DIR/.last-good-rev"
MODE="${DEPLOY_MODE:-docker}" # docker | systemd

cd "$APP_DIR"

run_backup() {
  if [ "$MODE" = "docker" ] && docker compose ps app >/dev/null 2>&1; then
    docker compose exec -T app node server-dist/node.mjs --backup || true
  elif [ -f server-dist/node.mjs ]; then
    node server-dist/node.mjs --backup || true
  fi
}

rebuild_and_restart() {
  if [ "$MODE" = "docker" ]; then
    docker compose up -d --build app
  else
    npm ci --no-audit --no-fund
    npm run build
    systemctl restart nashriyar
  fi
}

wait_healthy() {
  i=0
  while [ "$i" -lt 30 ]; do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      echo "[deploy] healthcheck OK ($HEALTH_URL)"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

if [ "${1:-}" = "--rollback" ]; then
  if [ ! -f "$STATE_FILE" ]; then
    echo "[deploy] no $STATE_FILE found — cannot rollback automatically" >&2
    exit 1
  fi
  PREV="$(cat "$STATE_FILE")"
  echo "[deploy] rolling back to $PREV"
  git checkout -f "$PREV"
  rebuild_and_restart
  wait_healthy
  echo "[deploy] rollback to $PREV succeeded"
  exit 0
fi

TARGET="${1:-origin/main}"
CURRENT="$(git rev-parse HEAD)"
echo "[deploy] current=$CURRENT target=$TARGET"

run_backup
git fetch --all --tags --prune
git checkout -f "$TARGET"
NEW_REV="$(git rev-parse HEAD)"

rebuild_and_restart

if wait_healthy; then
  printf '%s\n' "$CURRENT" > "$STATE_FILE"
  echo "[deploy] deployed $NEW_REV (previous good: $CURRENT)"
else
  echo "[deploy] healthcheck FAILED on $NEW_REV — auto-rolling back to $CURRENT" >&2
  git checkout -f "$CURRENT"
  rebuild_and_restart
  wait_healthy || true
  exit 1
fi
