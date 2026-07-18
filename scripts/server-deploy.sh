#!/usr/bin/env bash
set -euo pipefail

# Tabagheh production deploy — run on server: /app/tabagheh
#
# Modes:
#   ./deploy.sh                         auto: pull all, build only changed services
#   DEPLOY_SERVICES=all ./deploy.sh     force build frontend + backend + crawler
#   DEPLOY_SERVICES=frontend ./deploy.sh
#   DEPLOY_SERVICES=backend ./deploy.sh
#   DEPLOY_SERVICES=crawler ./deploy.sh
#   FORCE_BASE_BUILD=1 ./deploy.sh      rebuild Chromium base image

ROOT="${TABAGHEH_ROOT:-/app/tabagheh}"
BRANCH="${GIT_BRANCH:-main}"
DEPLOY_SERVICES="${DEPLOY_SERVICES:-auto}"

export DOCKER_BUILDKIT=1

FRONTEND_IMAGE="tabagheh-frontend:latest"
BACKEND_IMAGE="tabagheh-backend:latest"
CRAWLER_IMAGE="tabagheh-crawler:latest"
API_BASE_IMAGE="tabagheh-api-base:latest"

BASE_HASH_FILE="$ROOT/.deploy-api-base-hash"

log() { echo "[deploy] $*"; }

resolve_dir() {
  local primary="$1"
  local fallback="$2"
  if [ -d "$primary" ]; then
    echo "$primary"
  else
    echo "$fallback"
  fi
}

FRONTEND="$(resolve_dir "$ROOT/frontend" "$ROOT/tabaghe-frontend")"
BACKEND="$(resolve_dir "$ROOT/api" "$ROOT/tabaghe-api")"
CRAWLER="$(resolve_dir "$ROOT/crawler" "$ROOT/crawler")"

image_exists() {
  docker image inspect "$1" >/dev/null 2>&1
}

repo_head() {
  git -C "$1" rev-parse HEAD 2>/dev/null || echo ""
}

file_hash() {
  sha256sum "$1" | awk '{print $1}'
}

should_build_service() {
  local name="$1"
  local changed="$2"
  local image="$3"

  case "$DEPLOY_SERVICES" in
    all) return 0 ;;
    auto)
      if [ "$changed" = "1" ]; then
        return 0
      fi
      if ! image_exists "$image"; then
        log "$name image missing — will build"
        return 0
      fi
      return 1
      ;;
    *)
      case ",$DEPLOY_SERVICES," in
        *",$name,"*) return 0 ;;
        *) return 1 ;;
      esac
      ;;
  esac
}

sync_repo() {
  local dir="$1"
  local name="$2"

  if [ ! -d "$dir/.git" ]; then
    log "skip $name (no git repo at $dir)"
    return 0
  fi

  log "updating $name..."
  cd "$dir"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
  git clean -fd
}

ensure_api_base() {
  local base_dockerfile="$BACKEND/Dockerfile.base"
  if [ ! -f "$base_dockerfile" ]; then
    log "warning: $base_dockerfile not found — backend build may reinstall Chromium"
    return 0
  fi

  local current_hash
  current_hash="$(file_hash "$base_dockerfile")"
  local saved_hash=""
  if [ -f "$BASE_HASH_FILE" ]; then
    saved_hash="$(cat "$BASE_HASH_FILE")"
  fi

  if [ "${FORCE_BASE_BUILD:-0}" = "1" ] \
    || ! image_exists "$API_BASE_IMAGE" \
    || [ "$current_hash" != "$saved_hash" ]; then
    log "building api base image (Chromium — slow only when base is new or Dockerfile.base changed)..."
    docker build -f "$base_dockerfile" -t "$API_BASE_IMAGE" "$BACKEND"
    echo "$current_hash" > "$BASE_HASH_FILE"
  else
    log "api base image up to date (skip Chromium download)"
  fi
}

echo "======================================================"
echo "Tabagheh deploy — $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================================"

OLD_FE="$(repo_head "$FRONTEND")"
OLD_BE="$(repo_head "$BACKEND")"
OLD_CR=""
if [ -d "$CRAWLER/.git" ]; then
  OLD_CR="$(repo_head "$CRAWLER")"
fi

sync_repo "$FRONTEND" "frontend"
sync_repo "$BACKEND" "backend"
if [ -d "$CRAWLER/.git" ]; then
  sync_repo "$CRAWLER" "crawler"
fi

# Root /app/tabagheh is not a git repo — keep deploy.sh in sync from API
if [ -f "$BACKEND/scripts/server-deploy.sh" ]; then
  if ! cmp -s "$BACKEND/scripts/server-deploy.sh" "$ROOT/deploy.sh" 2>/dev/null; then
    log "updating $ROOT/deploy.sh from API scripts/server-deploy.sh"
    cp "$BACKEND/scripts/server-deploy.sh" "$ROOT/deploy.sh"
    chmod +x "$ROOT/deploy.sh"
  fi
fi

NEW_FE="$(repo_head "$FRONTEND")"
NEW_BE="$(repo_head "$BACKEND")"
NEW_CR=""
if [ -d "$CRAWLER/.git" ]; then
  NEW_CR="$(repo_head "$CRAWLER")"
fi

FE_CHANGED=0
BE_CHANGED=0
CR_CHANGED=0
[ "$OLD_FE" != "$NEW_FE" ] && FE_CHANGED=1
[ "$OLD_BE" != "$NEW_BE" ] && BE_CHANGED=1
[ -n "$OLD_CR" ] && [ "$OLD_CR" != "$NEW_CR" ] && CR_CHANGED=1
[ -z "$OLD_CR" ] && [ -n "$NEW_CR" ] && CR_CHANGED=1

BUILD_FE=0
BUILD_BE=0
BUILD_CR=0

if should_build_service "frontend" "$FE_CHANGED" "$FRONTEND_IMAGE"; then BUILD_FE=1; fi
if should_build_service "backend" "$BE_CHANGED" "$BACKEND_IMAGE"; then BUILD_BE=1; fi
if [ -d "$CRAWLER" ] && [ -f "$CRAWLER/Dockerfile" ]; then
  if should_build_service "crawler" "$CR_CHANGED" "$CRAWLER_IMAGE"; then BUILD_CR=1; fi
fi

if [ "$DEPLOY_SERVICES" = "auto" ]; then
  log "auto mode: frontend=$([ "$BUILD_FE" = 1 ] && echo build || echo skip) backend=$([ "$BUILD_BE" = 1 ] && echo build || echo skip) crawler=$([ "$BUILD_CR" = 1 ] && echo build || echo skip)"
fi

cd "$ROOT"

if [ "$BUILD_BE" = "1" ]; then
  # Optional: pre-build tagged base so Chromium layer survives `docker builder prune`.
  # Backend Dockerfile embeds api-base inline; --cache-from reuses it when present.
  ensure_api_base
  log "building backend image..."
  CACHE_FROM=()
  if image_exists "$API_BASE_IMAGE"; then
    CACHE_FROM=(--cache-from "$API_BASE_IMAGE")
  fi
  docker build "${CACHE_FROM[@]}" -t "$BACKEND_IMAGE" "$BACKEND"
fi

if [ "$BUILD_FE" = "1" ]; then
  log "building frontend image (5-10 min)..."
  docker build -t "$FRONTEND_IMAGE" "$FRONTEND"
fi

if [ "$BUILD_CR" = "1" ]; then
  log "building crawler image..."
  docker build -t "$CRAWLER_IMAGE" "$CRAWLER"
fi

if [ "$BUILD_FE" = "0" ] && [ "$BUILD_BE" = "0" ] && [ "$BUILD_CR" = "0" ]; then
  log "no image rebuild needed"
fi

RECREATE=()
[ "$BUILD_BE" = "1" ] && RECREATE+=(backend)
[ "$BUILD_FE" = "1" ] && RECREATE+=(frontend)
[ "$BUILD_CR" = "1" ] && RECREATE+=(crawler)

if [ ${#RECREATE[@]} -gt 0 ]; then
  log "recreating containers: ${RECREATE[*]}"
  docker compose up -d --force-recreate "${RECREATE[@]}"
else
  log "containers unchanged"
fi

# Keep infrastructure services running (service names match server compose)
docker compose up -d db gateway 2>/dev/null || docker compose up -d tabagheh-postgres tabagheh-gateway 2>/dev/null || true

if [ "$BUILD_BE" = "1" ]; then
  log "database migrate..."
  if docker compose ps --status running backend >/dev/null 2>&1; then
    docker compose exec -T backend npx prisma migrate deploy
    docker compose exec -T backend npx prisma generate
  elif docker compose ps --status running tabagheh-api >/dev/null 2>&1; then
    docker compose exec -T tabagheh-api npx prisma migrate deploy
    docker compose exec -T tabagheh-api npx prisma generate
  else
    log "warning: backend container not running — skip migrate"
  fi
fi

# Health check + SMS to admins (success or failure) — always after deploy
VERIFY_SCRIPT="$BACKEND/scripts/post-deploy-verify.sh"
if [ -f "$VERIFY_SCRIPT" ]; then
  log "post-deploy verify + admin SMS..."
  # Server compose uses api/.env; script also searches root/.env and tabaghe-api/.env
  ROOT="$ROOT" bash "$VERIFY_SCRIPT" || {
    log "ERROR: post-deploy verify failed (admin SMS should have been attempted)"
    docker compose ps
    exit 1
  }
else
  log "warning: $VERIFY_SCRIPT not found — skip verify/SMS"
fi

log "done."
docker compose ps
