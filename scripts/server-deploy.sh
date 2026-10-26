#!/usr/bin/env bash
set -euo pipefail

# Tabagheh production deploy — run on server: /app/tabagheh
#
# Modes:
#   ./deploy.sh                         auto: pull + build frontend/backend only when changed
#   DEPLOY_SERVICES=all ./deploy.sh     force build frontend + backend + crawler
#   DEPLOY_SERVICES=frontend ./deploy.sh
#   DEPLOY_SERVICES=backend ./deploy.sh
#   DEPLOY_SERVICES=crawler ./deploy.sh # crawler is opt-in (never built in auto — slow image)
#   DEPLOY_SERVICES=frontend,backend ./deploy.sh
#   FORCE_BASE_BUILD=1 ./deploy.sh      rebuild Chromium base image
#
# Crawler is intentionally excluded from "auto": Playwright/opencv builds take
# 10–20+ minutes on this host. Deploy crawler only via its own workflow or
# DEPLOY_SERVICES=crawler|all.
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
DEPLOY_SHA_FE_FILE="$ROOT/.deploy-frontend-sha"
DEPLOY_SHA_BE_FILE="$ROOT/.deploy-backend-sha"
DEPLOY_SHA_CR_FILE="$ROOT/.deploy-crawler-sha"

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
  local only_frontend=0
  if [ ${#RECREATE[@]} -eq 1 ] && [ "${RECREATE[0]}" = "frontend" ]; then
    only_frontend=1
  fi

  if [ "$only_frontend" = "1" ] && [[ "$reason" == "API" ]]; then
    log "skip rollback of frontend — API health failed independently of this image"
    rb_status="skipped-fe"
  elif [ "${CONTAINERS_RECREATED}" = "1" ] && [ ${#RECREATE[@]} -gt 0 ]; then
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

# Persistent BuildKit cache on disk — survives image retag/rebuild (frontend SSR stays ~3–6 min vs 15).
docker_build_with_local_cache() {
  local cache_name="$1"
  local tag="$2"
  local context="$3"
  shift 3
  local -a extra=("$@")

  local cache_dir="$ROOT/.buildkit-cache/$cache_name"
  mkdir -p "$cache_dir"

  local -a args=()
  if [ -n "$(ls -A "$cache_dir" 2>/dev/null)" ]; then
    args+=(--cache-from "type=local,src=$cache_dir")
  fi
  if image_exists "$tag"; then
    args+=(--cache-from "$tag")
  fi
  local prev
  prev="$(previous_tag "$tag")"
  if image_exists "$prev"; then
    args+=(--cache-from "$prev")
  fi

  docker build \
    "${args[@]}" \
    --cache-to "type=local,dest=$cache_dir,mode=max" \
    "${extra[@]}" \
    -t "$tag" \
    "$context"
}

repo_head() {
  git -C "$1" rev-parse HEAD 2>/dev/null || echo ""
}

file_hash() {
  sha256sum "$1" | awk '{print $1}'
}

# Crawler only when explicitly requested (never via auto).
wants_crawler() {
  case "$DEPLOY_SERVICES" in
    all|crawler) return 0 ;;
    auto) return 1 ;;
    *)
      case ",$DEPLOY_SERVICES," in
        *,crawler,*) return 0 ;;
        *) return 1 ;;
      esac
      ;;
  esac
}

should_build_service() {
  local name="$1"
  local changed="$2"
  local image="$3"

  # Keep crawler off the hot path for FE/BE deploys.
  if [ "$name" = "crawler" ] && ! wants_crawler; then
    return 1
  fi

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

# Optional legacy: local Gitea bare repos (disabled when origin is GitHub).
# Set USE_GITEA_MIRROR=1 only if you still deploy from git.tabagheh.com remotes.
USE_GITEA_MIRROR="${USE_GITEA_MIRROR:-0}"
GITEA_REPOS_ROOT="${GITEA_REPOS_ROOT:-/data/git/repositories}"
# Host path when Gitea runs in Docker (bind-mounted data):
#   /var/lib/docker/volumes/... or whatever mounts into the container at /data/git/repositories
# Default below matches common host layout if you bind-mount Gitea data:
if [ ! -d "$GITEA_REPOS_ROOT" ] && [ -d /var/lib/gitea/git/repositories ]; then
  GITEA_REPOS_ROOT=/var/lib/gitea/git/repositories
fi

local_gitea_mirror() {
  local dir="$1"
  local url owner repo
  url="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  [ -n "$url" ] || return 0

  # GitHub remotes always fetch from origin (never on-disk Gitea)
  if [[ "$url" == *github.com* ]]; then
    return 0
  fi

  [ "$USE_GITEA_MIRROR" = "1" ] || return 0

  # origin already points at the bare repo on disk
  if [[ "$url" == /* ]] && [ -d "$url" ]; then
    echo "$url"
    return 0
  fi

  # https://git.tabagheh.com/taha/tabaghe-frontend.git
  # git@git.tabagheh.com:taha/tabaghe-frontend.git
  if [[ "$url" =~ git\.tabagheh\.com[:/]+([^/]+)/([^/]+?)(\.git)?$ ]]; then
    owner="${BASH_REMATCH[1]}"
    repo="${BASH_REMATCH[2]}"
    echo "$GITEA_REPOS_ROOT/$owner/${repo}.git"
  fi
}

sync_repo() {
  local dir="$1"
  local name="$2"
  local mirror=""
  local origin_url=""

  if [ ! -d "$dir/.git" ]; then
    log "skip $name (no git repo at $dir)"
    return 0
  fi

  cd "$dir"
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  mirror="$(local_gitea_mirror "$dir")"

  if [ -n "$mirror" ] && [ -d "$mirror" ]; then
    log "updating $name via local Gitea mirror..."
    # bare repos are owned by gitea uid (1000); root needs safe.directory
    git config --global --add safe.directory "$mirror" 2>/dev/null || true
    git -c "safe.directory=$mirror" fetch "$mirror" \
      "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
  else
    log "updating $name from origin (${origin_url:-unknown})..."
    if ! git fetch origin "$BRANCH"; then
      log "ERROR: git fetch failed for $name — check origin remote and GitHub credentials"
      return 1
    fi
  fi

  git reset --hard "origin/$BRANCH"
  git clean -fd
}

reload_gateway_nginx() {
  local conf="$FRONTEND/nginx.conf"
  if [ ! -f "$conf" ]; then
    return 0
  fi

  # Gateway mounts host frontend/nginx.conf — reload so CSP/header changes apply
  # without waiting for a frontend image rebuild.
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'tabagheh-gateway'; then
    log "reloading gateway nginx (CSP / headers from $conf)..."
    docker exec tabagheh-gateway nginx -t
    docker exec tabagheh-gateway nginx -s reload
    return 0
  fi

  if docker compose ps --status running gateway 2>/dev/null | grep -q gateway; then
    log "reloading compose gateway nginx..."
    docker compose exec -T gateway nginx -t
    docker compose exec -T gateway nginx -s reload
  fi
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
  # Skip crawler git pull unless this deploy targets crawler (keeps FE/BE fast).
  if wants_crawler && [ -d "$CRAWLER/.git" ]; then
    sync_repo "$CRAWLER" "crawler"
  elif [ -d "$CRAWLER/.git" ]; then
    log "skipping crawler git sync (DEPLOY_SERVICES=$DEPLOY_SERVICES)"
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

# «تغییر نسبت به pull قبلی» — اگر کسی قبلاً pull کرده ولی image نساخته، این صفر می‌ماند.
FE_CHANGED=0
BE_CHANGED=0
CR_CHANGED=0
[ "$OLD_FE" != "$NEW_FE" ] && FE_CHANGED=1
[ "$OLD_BE" != "$NEW_BE" ] && BE_CHANGED=1
[ -n "$OLD_CR" ] && [ "$OLD_CR" != "$NEW_CR" ] && CR_CHANGED=1
[ -z "$OLD_CR" ] && [ -n "$NEW_CR" ] && CR_CHANGED=1

# «تصویر ساخته‌شده برای این SHA نیست» — حتی اگر pull تکراری باشد، image عقب‌افتاده را می‌سازد.
read_deploy_sha() {
  local f="$1"
  if [ -f "$f" ]; then cat "$f"; else echo ""; fi
}
BUILT_FE="$(read_deploy_sha "$DEPLOY_SHA_FE_FILE")"
BUILT_BE="$(read_deploy_sha "$DEPLOY_SHA_BE_FILE")"
BUILT_CR="$(read_deploy_sha "$DEPLOY_SHA_CR_FILE")"
[ -n "$NEW_FE" ] && [ "$BUILT_FE" != "$NEW_FE" ] && FE_CHANGED=1
[ -n "$NEW_BE" ] && [ "$BUILT_BE" != "$NEW_BE" ] && BE_CHANGED=1
[ -n "$NEW_CR" ] && [ "$BUILT_CR" != "$NEW_CR" ] && CR_CHANGED=1

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
  log "sha backend: git=$NEW_BE built=${BUILT_BE:-none}"
fi

cd "$ROOT"

# Snapshot current :latest before overwrite so we can roll back on bad deploy
if [ "$BUILD_BE" = "1" ]; then preserve_image_if_exists "$BACKEND_IMAGE"; fi
if [ "$BUILD_FE" = "1" ]; then preserve_image_if_exists "$FRONTEND_IMAGE"; fi
if [ "$BUILD_CR" = "1" ]; then preserve_image_if_exists "$CRAWLER_IMAGE"; fi

if [ "$BUILD_BE" = "1" ]; then
  # Required: Dockerfile FROM tabagheh-api-base:latest (Chromium survives builder prune).
  # Do not pass --cache-from on that tag — BuildKit looks for a cache manifest and errors.
  ensure_api_base
  log "building backend image..."
  # --network=host: npm ci inside BuildKit often ETIMEDOUT on default bridge
  docker build --network=host \
    --build-arg NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}" \
    -t "$BACKEND_IMAGE" "$BACKEND"
  echo "$NEW_BE" > "$DEPLOY_SHA_BE_FILE"
fi

if [ "$BUILD_FE" = "1" ]; then
  log "building frontend image (cached SSR — first run slow, later runs faster)..."
  docker_build_with_local_cache frontend "$FRONTEND_IMAGE" "$FRONTEND"
  echo "$NEW_FE" > "$DEPLOY_SHA_FE_FILE"
fi

if [ "$BUILD_CR" = "1" ]; then
  log "building crawler image..."
  docker build -t "$CRAWLER_IMAGE" "$CRAWLER"
  echo "$NEW_CR" > "$DEPLOY_SHA_CR_FILE"
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

# Apply host-mounted gateway nginx.conf (CSP, etc.) after frontend sync
reload_gateway_nginx

# Always apply pending Prisma migrations when the backend image exists.
# Frontend-only deploys still ship an API client that expects current columns;
# skipping migrate leaves Nest crash-looping (P2022).
log "database migrate..."
MIGRATE_ATTEMPTED=1
if ! docker compose run --rm --no-deps --entrypoint npx backend prisma migrate deploy; then
  handle_deploy_failure "migrate"
fi
docker compose exec -T backend npx prisma generate 2>/dev/null || true

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
