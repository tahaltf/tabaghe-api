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
#
# Auto-rollback: before rebuild, :latest is tagged :previous. If migrate or
# post-deploy health/gateway checks fail, :previous is restored to :latest and
# those containers are recreated, then admins get an SMS (ناموفق).

ROOT="${TABAGHEH_ROOT:-/app/tabagheh}"
BRANCH="${GIT_BRANCH:-main}"
DEPLOY_SERVICES="${DEPLOY_SERVICES:-auto}"

export DOCKER_BUILDKIT=1

FRONTEND_IMAGE="tabagheh-frontend:latest"
BACKEND_IMAGE="tabagheh-backend:latest"
CRAWLER_IMAGE="tabagheh-crawler:latest"
API_BASE_IMAGE="tabagheh-api-base:latest"

BASE_HASH_FILE="$ROOT/.deploy-api-base-hash"
DEPLOY_STATUS_FILE="$ROOT/.deploy-last-status"

log() { echo "[deploy] $*"; }

RECREATE=()
CONTAINERS_RECREATED=0
MIGRATE_ATTEMPTED=0
_DEPLOY_FAIL_HANDLED=0
_DEPLOY_ERR_SMS=1

previous_tag() {
  # tabagheh-backend:latest → tabagheh-backend:previous
  local latest="$1"
  echo "${latest%:latest}:previous"
}

resolve_verify_script() {
  local be="${BACKEND:-}"
  if [ -n "$be" ] && [ -f "$be/scripts/post-deploy-verify.sh" ]; then
    echo "$be/scripts/post-deploy-verify.sh"
  elif [ -f "$ROOT/api/scripts/post-deploy-verify.sh" ]; then
    echo "$ROOT/api/scripts/post-deploy-verify.sh"
  elif [ -f "$ROOT/tabaghe-api/scripts/post-deploy-verify.sh" ]; then
    echo "$ROOT/tabaghe-api/scripts/post-deploy-verify.sh"
  else
    echo ""
  fi
}

send_deploy_sms() {
  local status_fa="$1"
  local detail="$2"
  local vs out ec=0
  vs="$(resolve_verify_script)"
  if [ -z "$vs" ]; then
    log "warning: post-deploy-verify.sh not found — cannot SMS"
    return 0
  fi
  detail="$(echo "$detail" | tr '\n' ' ' | cut -c1-70)"
  log "sending deploy result SMS (${status_fa}) detail=${detail} via ${vs}..."
  # Do not pipe to `while` (subshell + pipefail can hide failures). Capture, then log.
  set +e
  out="$(
    ROOT="$ROOT" SMS_ONLY=1 SMS_STATUS="$status_fa" SMS_DETAIL="$detail" \
      bash "$vs" 2>&1
  )"
  ec=$?
  set -e
  if [ -n "$out" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      log "$line"
    done <<< "$out"
  fi
  if [ "$ec" -ne 0 ]; then
    log "warning: deploy SMS script exit=${ec}"
  else
    log "deploy SMS step finished (exit=0)"
  fi
}

# $ROOT/deploy.sh must stay a thin wrapper — never overwrite a running bash script mid-flight.
install_root_deploy_wrapper() {
  local next="$ROOT/deploy.sh.next"
  cat > "$next" <<'WRAP'
#!/usr/bin/env bash
set -euo pipefail
ROOT="${TABAGHEH_ROOT:-/app/tabagheh}"
if [ -f "$ROOT/api/scripts/server-deploy.sh" ]; then
  exec bash "$ROOT/api/scripts/server-deploy.sh" "$@"
fi
if [ -f "$ROOT/tabaghe-api/scripts/server-deploy.sh" ]; then
  exec bash "$ROOT/tabaghe-api/scripts/server-deploy.sh" "$@"
fi
echo "server-deploy.sh not found under $ROOT" >&2
exit 1
WRAP
  chmod +x "$next"
  mv -f "$next" "$ROOT/deploy.sh"
}

preserve_image_if_exists() {
  local latest="$1"
  local prev
  prev="$(previous_tag "$latest")"
  if image_exists "$latest"; then
    log "preserving $latest → $prev"
    docker tag "$latest" "$prev"
  else
    log "no existing $latest to preserve as :previous"
  fi
}

# Returns 0 if at least one service was retagged from :previous.
rollback_recreated_services() {
  if [ ${#RECREATE[@]} -eq 0 ]; then
    log "rollback skipped — no recreated services"
    return 1
  fi

  local svc latest prev rolled=0
  for svc in "${RECREATE[@]}"; do
    case "$svc" in
      backend|tabagheh-api) latest="$BACKEND_IMAGE" ;;
      frontend) latest="$FRONTEND_IMAGE" ;;
      crawler) latest="$CRAWLER_IMAGE" ;;
      *)
        log "warning: unknown service for rollback: $svc"
        continue
        ;;
    esac
    prev="$(previous_tag "$latest")"
    if image_exists "$prev"; then
      log "rollback image: $prev → $latest"
      docker tag "$prev" "$latest"
      rolled=1
    else
      log "warning: missing $prev — cannot rollback $svc"
    fi
  done

  if [ "$rolled" = "0" ]; then
    log "rollback failed — no :previous images available"
    return 1
  fi

  log "recreating rolled-back containers: ${RECREATE[*]}"
  docker compose up -d --force-recreate "${RECREATE[@]}"
  return 0
}

# reason: migrate | health | exit N | ...
handle_deploy_failure() {
  local reason="$1"
  _DEPLOY_FAIL_HANDLED=1
  _DEPLOY_ERR_SMS=0
  trap - ERR

  local rb_status="skipped"
  if [ "${CONTAINERS_RECREATED}" = "1" ] && [ ${#RECREATE[@]} -gt 0 ]; then
    if rollback_recreated_services; then
      rb_status="rbOK"
      local vs
      vs="$(resolve_verify_script)"
      if [ -n "$vs" ]; then
        log "post-rollback health check (best-effort)..."
        if ROOT="$ROOT" SKIP_SMS=1 DEPLOY_STATUS_FILE="$DEPLOY_STATUS_FILE" \
          bash "$vs"; then
          rb_status="rbOK+up"
        else
          rb_status="rbOK+down"
        fi
      fi
    else
      rb_status="rbFail"
    fi
  fi

  local detail="${reason}; ${rb_status}"
  if [ "$MIGRATE_ATTEMPTED" = "1" ]; then
    detail="${detail}; DB not reverted"
  fi

  log "ERROR: deploy failed — ${detail}"
  send_deploy_sms "ناموفق" "$detail"
  docker compose ps || true
  exit 1
}

on_deploy_err() {
  local ec=$?
  [[ "${_DEPLOY_FAIL_HANDLED}" = "0" ]] || return 0
  if [ "${CONTAINERS_RECREATED}" = "1" ]; then
    handle_deploy_failure "exit ${ec}"
  fi
  [[ "${_DEPLOY_ERR_SMS}" = "1" ]] || return 0
  _DEPLOY_FAIL_HANDLED=1
  log "ERROR: deploy aborted (exit=$ec) — attempting failure SMS..."
  send_deploy_sms "ناموفق" "deploy exit ${ec}"
}
trap 'on_deploy_err' ERR

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

# Stage 0: copy this script to /tmp before any git reset — otherwise
# `sync_repo backend` overwrites the running file and bash skips/breaks the SMS tail.
if [ "${_TABAGHEH_DEPLOY_BOOTSTRAPPED:-0}" != "1" ] \
  && [ "${_TABAGHEH_DEPLOY_FROM_TMP:-0}" != "1" ]; then
  _deploy_tmp="$(mktemp /tmp/tabagheh-deploy.XXXXXX.sh)"
  cp "${BASH_SOURCE[0]}" "$_deploy_tmp"
  chmod +x "$_deploy_tmp"
  export _TABAGHEH_DEPLOY_FROM_TMP=1
  exec bash "$_deploy_tmp"
fi

# Stage 1: capture pre-sync HEADs, pull, install thin ./deploy.sh wrapper, then
# re-exec the synced canonical script (never continue after mutating $0).
if [ "${_TABAGHEH_DEPLOY_BOOTSTRAPPED:-0}" != "1" ]; then
  log "bootstrap: sync repos, then re-exec canonical deploy script"
  _BOOT_OLD_FE="$(repo_head "$FRONTEND")"
  _BOOT_OLD_BE="$(repo_head "$BACKEND")"
  _BOOT_OLD_CR=""
  if [ -d "$CRAWLER/.git" ]; then
    _BOOT_OLD_CR="$(repo_head "$CRAWLER")"
  fi

  sync_repo "$FRONTEND" "frontend"
  sync_repo "$BACKEND" "backend"
  if [ -d "$CRAWLER/.git" ]; then
    sync_repo "$CRAWLER" "crawler"
  fi

  if [ ! -f "$BACKEND/scripts/server-deploy.sh" ]; then
    log "ERROR: missing $BACKEND/scripts/server-deploy.sh"
    exit 1
  fi

  install_root_deploy_wrapper
  export _TABAGHEH_DEPLOY_BOOTSTRAPPED=1
  export _DEPLOY_OLD_FE="$_BOOT_OLD_FE"
  export _DEPLOY_OLD_BE="$_BOOT_OLD_BE"
  export _DEPLOY_OLD_CR="$_BOOT_OLD_CR"
  export TABAGHEH_ROOT="$ROOT"
  export GIT_BRANCH="$BRANCH"
  export DEPLOY_SERVICES="$DEPLOY_SERVICES"
  log "re-exec → $BACKEND/scripts/server-deploy.sh"
  exec bash "$BACKEND/scripts/server-deploy.sh"
fi

echo "======================================================"
echo "Tabagheh deploy — $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================================"

OLD_FE="${_DEPLOY_OLD_FE-}"
OLD_BE="${_DEPLOY_OLD_BE-}"
OLD_CR="${_DEPLOY_OLD_CR-}"

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

# Snapshot current :latest before overwrite so we can roll back on bad deploy
if [ "$BUILD_BE" = "1" ]; then preserve_image_if_exists "$BACKEND_IMAGE"; fi
if [ "$BUILD_FE" = "1" ]; then preserve_image_if_exists "$FRONTEND_IMAGE"; fi
if [ "$BUILD_CR" = "1" ]; then preserve_image_if_exists "$CRAWLER_IMAGE"; fi

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
  CONTAINERS_RECREATED=1
else
  log "containers unchanged"
fi

# Keep infrastructure services running (service names match server compose)
docker compose up -d db gateway 2>/dev/null || docker compose up -d tabagheh-postgres tabagheh-gateway 2>/dev/null || true

if [ "$BUILD_BE" = "1" ]; then
  log "database migrate..."
  MIGRATE_ATTEMPTED=1
  if docker compose ps --status running backend >/dev/null 2>&1; then
    if ! docker compose exec -T backend npx prisma migrate deploy; then
      handle_deploy_failure "migrate"
    fi
    docker compose exec -T backend npx prisma generate || true
  elif docker compose ps --status running tabagheh-api >/dev/null 2>&1; then
    if ! docker compose exec -T tabagheh-api npx prisma migrate deploy; then
      handle_deploy_failure "migrate"
    fi
    docker compose exec -T tabagheh-api npx prisma generate || true
  else
    log "warning: backend container not running — skip migrate"
    MIGRATE_ATTEMPTED=0
  fi
fi

# Health check — SMS owned by this script (success here, or failure after rollback)
_DEPLOY_ERR_SMS=0
trap - ERR
VERIFY_SCRIPT="$(resolve_verify_script)"
if [ -n "$VERIFY_SCRIPT" ]; then
  log "post-deploy verify (SMS deferred to deploy.sh)..."
  rm -f "$DEPLOY_STATUS_FILE" 2>/dev/null || true
  if ! ROOT="$ROOT" SKIP_SMS=1 DEPLOY_STATUS_FILE="$DEPLOY_STATUS_FILE" bash "$VERIFY_SCRIPT"; then
    fail_reason="health"
    if [ -f "$DEPLOY_STATUS_FILE" ]; then
      fail_reason="$(tr -d '\r\n' < "$DEPLOY_STATUS_FILE" | cut -c1-40)"
      [ -n "$fail_reason" ] || fail_reason="health"
    fi
    handle_deploy_failure "$fail_reason"
  fi
  send_deploy_sms "موفق" "API+Gateway OK"
else
  log "warning: post-deploy-verify.sh not found — skip verify/SMS"
fi

log "done."
docker compose ps
