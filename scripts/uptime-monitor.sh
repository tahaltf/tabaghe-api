#!/usr/bin/env bash
# Uptime monitor — probe health/gateway and SMS admins on state change only.
#
# Install on server (every 5 minutes):
#   mkdir -p /app/tabagheh/logs
#   crontab -e
#   */5 * * * * ROOT=/app/tabagheh bash /app/tabagheh/api/scripts/uptime-monitor.sh >> /app/tabagheh/logs/uptime-monitor.log 2>&1
#
# Behavior:
#   - UP → 2 consecutive failures → SMS «قطع» (once; retries if send failed)
#   - Disk <100MB free → treat as DOWN immediately (threshold=1) + SMS
#   - State stored on /dev/shm first so full root disk still tracks FAIL_COUNT
#   - On probe failure: host .env SMS first (API/DB often also down)
#   - DOWN → keep probing, no repeat SMS (unless pending_sms=down)
#   - DOWN → first success → SMS «وصل» (retries until send succeeds)
#   - FORCE_UPTIME_SMS=وصل|قطع — send immediately (manual)
#
# Env (MUST be in api/.env for DB/disk outages — panel alone is not enough):
#   UPTIME_MONITOR_ENABLED=0|1     (default 1; host kill-switch)
#   UPTIME_FAIL_THRESHOLD=2        (consecutive fails before DOWN)
#   CHECK_GATEWAY=1
#   HEALTH_URL / GATEWAY_URL
#   SMS_UPTIME_ALERT_ENABLED=0|1
#   SMS_UPTIME_ALERT_RECIPIENTS=0912...,0913...
#   SMS_UPTIME_ALERT_TEMPLATE_ID=...     (sms.ir — یا SMS_IR_LINE_NUMBER برای bulk)
#   SMS_UPTIME_ALERT_TEMPLATE_NAME=...   (kavenegar)
#   SMS_IR_API_KEY / SMS_IR_LINE_NUMBER
#   DEPLOY_NOTIFY_TOKEN=...        (optional)
#
set -euo pipefail

ROOT="${ROOT:-/app/tabagheh}"
UPTIME_MONITOR_ENABLED="${UPTIME_MONITOR_ENABLED:-1}"
UPTIME_FAIL_THRESHOLD="${UPTIME_FAIL_THRESHOLD:-2}"
CHECK_GATEWAY="${CHECK_GATEWAY:-1}"
# Prefer tmpfs for state: when / is full, disk-backed state cannot update and
# FAIL_COUNT never reaches threshold → SMS «قطع» never fires (this outage class).
STATE_FILE_DISK="${UPTIME_STATE_FILE:-$ROOT/.uptime-monitor-state}"
STATE_FILE_SHM="${UPTIME_STATE_SHM:-/dev/shm/tabagheh-uptime-monitor.state}"
STATE_FILE="$STATE_FILE_SHM"
PROBE_FAILED=0
DISK_CRITICAL=0

log() { echo "[uptime $(date '+%Y-%m-%d %H:%M:%S')] $*"; }
warn() { echo "[uptime $(date '+%Y-%m-%d %H:%M:%S')] WARN: $*" >&2; }

disk_avail_kb() {
  # Avail KB for / (portable-ish); empty on failure
  df -Pk / 2>/dev/null | awk 'NR==2 {print $4}'
}

check_disk_critical() {
  local avail
  avail="$(disk_avail_kb)"
  [[ "$avail" =~ ^[0-9]+$ ]] || return 1
  # < 100MB free → critical (Postgres cannot write postmaster.pid)
  if (( avail < 102400 )); then
    DISK_CRITICAL=1
    return 0
  fi
  return 1
}

ENV_FILES=()
_add_env_file() {
  local f="$1"
  [[ -n "$f" && -f "$f" ]] || return 0
  local x
  for x in "${ENV_FILES[@]+"${ENV_FILES[@]}"}"; do
    [[ "$x" == "$f" ]] && return 0
  done
  ENV_FILES+=("$f")
}
_add_env_file "${ENV_FILE:-}"
_add_env_file "$ROOT/.env"
_add_env_file "$ROOT/api/.env"
_add_env_file "$ROOT/tabaghe-api/.env"

load_env_var() {
  local key="$1"
  local f line
  for f in "${ENV_FILES[@]+"${ENV_FILES[@]}"}"; do
    line="$(grep -E "^${key}=" "$f" 2>/dev/null | tail -n1 || true)"
    [[ -n "$line" ]] || continue
    printf '%s' "${line#*=}" | sed 's/^["'\'']//; s/["'\'']$//'
    return 0
  done
  return 0
}

enabled_host="$(load_env_var UPTIME_MONITOR_ENABLED)"
enabled_host="${enabled_host:-$UPTIME_MONITOR_ENABLED}"
if [[ "$enabled_host" == "0" || "$enabled_host" == "false" || "$enabled_host" == "no" ]]; then
  log "UPTIME_MONITOR_ENABLED=0 — skip"
  exit 0
fi

threshold="$(load_env_var UPTIME_FAIL_THRESHOLD)"
threshold="${threshold:-$UPTIME_FAIL_THRESHOLD}"
[[ "$threshold" =~ ^[1-9][0-9]*$ ]] || threshold=2

SMS_IR_HOST_IP="$(load_env_var SMS_IR_HOST_IP)"
SMS_IR_HOST_IP="${SMS_IR_HOST_IP:-185.211.56.44}"

curl_smsir() {
  curl -sS --max-time 20 --resolve "api.sms.ir:443:${SMS_IR_HOST_IP}" "$@"
}

_http_port="$(load_env_var HTTP_PORT)"
# Production compose gateway is usually 8080; host nginx may be 80.
_http_port="${_http_port:-8080}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${_http_port}/api/v1/health}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:${_http_port}/}"

normalize_mobile() {
  local raw="$1"
  raw="$(echo "$raw" | tr -d '[:space:]-')"
  raw="${raw#+}"
  if [[ "$raw" =~ ^98(9[0-9]{9})$ ]]; then
    echo "0${BASH_REMATCH[1]}"
    return
  fi
  if [[ "$raw" =~ ^9[0-9]{9}$ ]]; then
    echo "0$raw"
    return
  fi
  if [[ "$raw" =~ ^09[0-9]{9}$ ]]; then
    echo "$raw"
    return
  fi
  echo ""
}

parse_recipients() {
  local raw="$1"
  local part norm
  local -a out=()
  IFS=$',;\n\r' read -r -a parts <<< "$raw"
  for part in "${parts[@]}"; do
    norm="$(normalize_mobile "$part")"
    [[ -n "$norm" ]] || continue
    local seen=0 x
    for x in "${out[@]+"${out[@]}"}"; do
      [[ "$x" == "$norm" ]] && seen=1 && break
    done
    [[ "$seen" -eq 1 ]] && continue
    out+=("$norm")
  done
  printf '%s\n' "${out[@]+"${out[@]}"}"
}

json_escape() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.dumps(sys.argv[1], ensure_ascii=False)[1:-1])' "$1"
    return
  fi
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/ }"
  s="${s//$'\r'/}"
  printf '%s' "$s"
}

http_ok() {
  local url="$1"
  local code body_file
  body_file="/tmp/tabagheh-uptime-body.$$"
  code="$(curl -sS -o "$body_file" -w '%{http_code}' --max-time 8 "$url" 2>/dev/null || echo 000)"
  if [[ "$code" =~ ^2 ]]; then
    if [[ "$url" == *"/health"* ]]; then
      if grep -qE '"ok"[[:space:]]*:[[:space:]]*true|"status"[[:space:]]*:[[:space:]]*"up"' "$body_file" 2>/dev/null; then
        rm -f "$body_file"
        return 0
      fi
      rm -f "$body_file"
      return 1
    fi
    rm -f "$body_file"
    return 0
  fi
  rm -f "$body_file"
  return 1
}

api_health_via_docker() {
  local svc body
  cd "$ROOT" 2>/dev/null || true
  for svc in backend tabagheh-api; do
    if docker compose ps --status running "$svc" >/dev/null 2>&1; then
      body="$(docker compose exec -T "$svc" wget -qO- http://127.0.0.1:3000/api/v1/health 2>/dev/null \
        || docker compose exec -T "$svc" curl -sS --max-time 5 http://127.0.0.1:3000/api/v1/health 2>/dev/null \
        || true)"
      if echo "$body" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true|"status"[[:space:]]*:[[:space:]]*"up"'; then
        return 0
      fi
    fi
  done
  return 1
}

gateway_http_ok() {
  local url code
  for url in "$@"; do
    [[ -n "$url" ]] || continue
    code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 8 "$url" 2>/dev/null || echo 000)"
    if [[ "$code" =~ ^2|^3 ]]; then
      GATEWAY_OK_URL="$url"
      return 0
    fi
  done
  return 1
}

probe_site() {
  local failures=()
  GATEWAY_OK_URL=""
  if http_ok "$HEALTH_URL" || api_health_via_docker; then
    :
  else
    # Fallbacks when HEALTH_URL points at wrong host port
    if http_ok "http://127.0.0.1:8080/api/v1/health" \
      || http_ok "http://127.0.0.1:80/api/v1/health"; then
      :
    else
      failures+=("API")
    fi
  fi
  if [[ "$CHECK_GATEWAY" == "1" ]]; then
    if gateway_http_ok \
      "$GATEWAY_URL" \
      "http://127.0.0.1:8080/" \
      "http://127.0.0.1:80/" \
      "http://127.0.0.1:4000/"; then
      :
    else
      failures+=("Gateway")
    fi
  fi
  if [[ ${#failures[@]} -eq 0 ]]; then
    return 0
  fi
  PROBE_REASON="$(IFS=+; echo "${failures[*]}")"
  return 1
}

_parse_state_file() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  STATUS="$(grep -E '^status=' "$f" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  FAIL_COUNT="$(grep -E '^fail_count=' "$f" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  PENDING_SMS="$(grep -E '^pending_sms=' "$f" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  return 0
}

read_state() {
  STATUS="up"
  FAIL_COUNT=0
  PENDING_SMS=""
  # Prefer shm (survives full root disk); fall back to disk copy from before outage
  if ! _parse_state_file "$STATE_FILE_SHM"; then
    _parse_state_file "$STATE_FILE_DISK" || true
  fi
  [[ "$STATUS" == "down" ]] || STATUS="up"
  [[ "$FAIL_COUNT" =~ ^[0-9]+$ ]] || FAIL_COUNT=0
  [[ "$PENDING_SMS" == "up" || "$PENDING_SMS" == "down" ]] || PENDING_SMS=""
  STATE_FILE="$STATE_FILE_SHM"
}

write_state() {
  local st="$1"
  local fc="$2"
  local pending="${3:-}"
  local body
  body="$(
    printf 'status=%s\nfail_count=%s\nupdated=%s\n' "$st" "$fc" "$(date -Iseconds 2>/dev/null || date)"
    if [[ -n "$pending" ]]; then
      printf 'pending_sms=%s\n' "$pending"
    fi
  )"
  # Always try tmpfs first (works when / is 100% full)
  if printf '%s' "$body" > "$STATE_FILE_SHM" 2>/dev/null; then
    STATE_FILE="$STATE_FILE_SHM"
    # Best-effort mirror to disk for reboot persistence
    printf '%s' "$body" > "$STATE_FILE_DISK" 2>/dev/null || true
    return 0
  fi
  if printf '%s' "$body" > "$STATE_FILE_DISK" 2>/dev/null; then
    STATE_FILE="$STATE_FILE_DISK"
    warn "state نوشته شد روی دیسک (shm ناموفق)"
    return 0
  fi
  warn "نتوانست state را بنویسد (دیسک پر؟) — SMS همچنان تلاش می‌شود"
  return 0
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=sms-host-notify.sh
source "$SCRIPT_DIR/sms-host-notify.sh"

notify_via_api() {
  sms_notify_via_api "uptime-sms-alert" "$1" "$2"
}

send_sms_smsir_verify() {
  local api_key="$1" mobile="$2" template_id="$3"
  local status_name="$4" status_value="$5" detail_name="$6" detail_value="$7"
  local params
  params="$(printf '[{"name":"%s","value":"%s"},{"name":"%s","value":"%s"}]' \
    "$status_name" "$status_value" "$detail_name" "$detail_value")"
  curl_smsir -X POST "https://api.sms.ir/v1/send/verify" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -H "x-api-key: ${api_key}" \
    -d "$(printf '{"mobile":"%s","templateId":%s,"parameters":%s}' "$mobile" "$template_id" "$params")" \
    >/dev/null 2>&1
}

send_sms_smsir_bulk() {
  local api_key="$1" mobile="$2" line_number="$3" message="$4"
  [[ -n "$line_number" ]] || return 1
  curl_smsir -X POST "https://api.sms.ir/v1/send/bulk" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -H "x-api-key: ${api_key}" \
    -d "$(printf '{"lineNumber":"%s","messageText":"%s","mobiles":["%s"]}' \
      "$line_number" "$(json_escape "$message")" "$mobile")" \
    >/dev/null 2>&1
}

send_sms_kavenegar() {
  local api_key="$1" mobile="$2" template_name="$3" status_value="$4" detail_value="$5"
  if [[ -n "$template_name" ]]; then
    curl -sS --max-time 20 -G \
      "https://api.kavenegar.com/v1/${api_key}/verify/lookup.json" \
      --data-urlencode "receptor=${mobile}" \
      --data-urlencode "template=${template_name}" \
      --data-urlencode "token=${status_value}" \
      --data-urlencode "token2=${detail_value}" >/dev/null 2>&1 \
      && return 0
  fi
  local msg="سامانه طبقه: ${status_value} — ${detail_value}"
  curl -sS --max-time 20 -X POST \
    "https://api.kavenegar.com/v1/${api_key}/sms/send.json" \
    --data-urlencode "receptor=${mobile}" \
    --data-urlencode "message=${msg}" >/dev/null 2>&1
}

notify_via_env() {
  local status_fa="$1"
  local detail="$2"

  local enabled_env
  enabled_env="$(load_env_var SMS_UPTIME_ALERT_ENABLED)"
  enabled_env="${enabled_env:-1}"
  if [[ "$enabled_env" == "0" || "$enabled_env" == "false" ]]; then
    warn "SMS_UPTIME_ALERT_ENABLED=0 — host SMS ارسال نشد"
    return 1
  fi

  local recipients_raw
  recipients_raw="$(load_env_var SMS_UPTIME_ALERT_RECIPIENTS)"
  if [[ -z "${recipients_raw// /}" ]]; then
    recipients_raw="$(load_env_var SMS_DEPLOY_ALERT_RECIPIENTS)"
  fi
  if [[ -z "${recipients_raw// /}" ]]; then
    recipients_raw="$(load_env_var SMS_ADMIN_LOGIN_ALERT_RECIPIENTS)"
  fi
  if [[ -z "${recipients_raw// /}" ]]; then
    warn "SMS ارسال نشد: گیرنده در .env ست نشده (SMS_UPTIME_ALERT_RECIPIENTS) — پنل وقتی DB قطع است در دسترس نیست"
    return 1
  fi

  local provider template_id template_name status_param detail_param line_number
  provider="$(load_env_var ACTIVE_SMS_PROVIDER)"
  provider="$(echo "${provider:-smsir}" | tr '[:upper:]' '[:lower:]')"
  template_id="$(load_env_var SMS_UPTIME_ALERT_TEMPLATE_ID)"
  if [[ -z "$template_id" || "$template_id" == "0" ]]; then
    template_id="$(load_env_var SMS_DEPLOY_ALERT_TEMPLATE_ID)"
  fi
  template_name="$(load_env_var SMS_UPTIME_ALERT_TEMPLATE_NAME)"
  if [[ -z "$template_name" ]]; then
    template_name="$(load_env_var SMS_DEPLOY_ALERT_TEMPLATE_NAME)"
  fi
  line_number="$(load_env_var SMS_IR_LINE_NUMBER)"
  status_param="$(load_env_var SMS_UPTIME_ALERT_STATUS_PARAMETER)"
  status_param="${status_param:-STATUS}"
  detail_param="$(load_env_var SMS_UPTIME_ALERT_DETAIL_PARAMETER)"
  detail_param="${detail_param:-DETAIL}"

  detail="$(echo "$detail" | tr '\n' ' ' | cut -c1-70)"
  local stamp
  stamp="$(TZ=Asia/Tehran date '+%m/%d %H:%M')"
  if [[ -z "$detail" ]]; then
    detail="$stamp"
  else
    detail="${stamp} ${detail}"
  fi

  local -a mobiles=()
  mapfile -t mobiles < <(parse_recipients "$recipients_raw")
  if [[ ${#mobiles[@]} -eq 0 ]]; then
    warn "شماره معتبر پیدا نشد"
    return 1
  fi

  if [[ "$provider" != "kavenegar" ]]; then
    if [[ -z "$template_id" || "$template_id" == "0" ]] && [[ -z "$line_number" ]]; then
      warn "SMS ارسال نشد: SMS_UPTIME_ALERT_TEMPLATE_ID یا SMS_IR_LINE_NUMBER را در api/.env ست کنید"
      return 1
    fi
  fi

  log "ارسال SMS مانیتور (وضعیت=${status_fa}) به ${#mobiles[@]} ادمین via ${provider} (.env)..."
  local ok=0 m api_key plain_msg
  plain_msg="مانیتور طبقه: ${status_fa} — ${detail}"
  for m in "${mobiles[@]}"; do
    if [[ "$provider" == "kavenegar" ]]; then
      api_key="$(load_env_var KAVENEGAR_API_KEY)"
      [[ -n "$api_key" ]] || { warn "KAVENEGAR_API_KEY missing"; return 1; }
      if send_sms_kavenegar "$api_key" "$m" "$template_name" "$status_fa" "$detail"; then
        ok=$((ok + 1))
      fi
    else
      api_key="$(load_env_var SMS_IR_API_KEY)"
      [[ -n "$api_key" ]] || { warn "SMS_IR_API_KEY missing"; return 1; }
      if [[ -n "$template_id" && "$template_id" != "0" ]] \
        && send_sms_smsir_verify "$api_key" "$m" "$template_id" \
          "$status_param" "$status_fa" "$detail_param" "$detail"; then
        ok=$((ok + 1))
      elif send_sms_smsir_bulk "$api_key" "$m" "$line_number" "$plain_msg"; then
        ok=$((ok + 1))
      else
        warn "sms.ir failed for $m"
      fi
    fi
  done
  log "SMS: ${ok}/${#mobiles[@]} ارسال شد"
  [[ "$ok" -gt 0 ]]
}

notify_admins_sms() {
  local status_fa="$1"
  local detail="$2"

  # When health already failed, API SMS path usually cannot read panel settings
  # from Postgres either — prefer host .env first so DB outages still alert.
  if [[ "$PROBE_FAILED" -eq 1 || "$DISK_CRITICAL" -eq 1 ]]; then
    if notify_via_env "$status_fa" "$detail"; then
      return 0
    fi
    warn "host .env SMS ناموفق — تلاش از طریق API..."
  fi

  local api_rc=0
  if notify_via_api "$status_fa" "$detail"; then
    return 0
  else
    api_rc=$?
  fi
  if [[ "$api_rc" -eq 2 ]]; then
    # Panel reached but sent=0 (template/recipients/disabled) — do NOT pretend success,
    # otherwise recovery SMS «وصل» is skipped forever after state flips to up.
    # Still try .env if panel settings incomplete but host env is configured.
    warn "پنل در دسترس بود ولی SMS ارسال نشد — fallback به .env"
    notify_via_env "$status_fa" "$detail"
    return $?
  fi

  if [[ "$PROBE_FAILED" -eq 1 || "$DISK_CRITICAL" -eq 1 ]]; then
    warn "API و .env هر دو ناموفق"
    return 1
  fi

  warn "ارسال از API ناموفق — fallback به .env"
  notify_via_env "$status_fa" "$detail"
}

# --- main ---
# Manual: FORCE_UPTIME_SMS=وصل|قطع ROOT=/app/tabagheh bash uptime-monitor.sh
read_state
PROBE_REASON=""

if check_disk_critical; then
  avail_kb="$(disk_avail_kb)"
  log "DISK CRITICAL: / avail=${avail_kb:-?}KB"
  PROBE_REASON="DiskFull"
fi

if [[ -n "${FORCE_UPTIME_SMS:-}" ]]; then
  log "FORCE_UPTIME_SMS=${FORCE_UPTIME_SMS}"
  if notify_admins_sms "$FORCE_UPTIME_SMS" "ارسال دستی مانیتور"; then
    log "FORCE SMS OK"
    if [[ "$FORCE_UPTIME_SMS" == "وصل" ]]; then
      write_state "up" 0
    elif [[ "$FORCE_UPTIME_SMS" == "قطع" ]]; then
      write_state "down" "$threshold"
    fi
    exit 0
  fi
  warn "FORCE SMS failed"
  exit 1
fi

if probe_site && [[ "$DISK_CRITICAL" -eq 0 ]]; then
  log "probe OK (prev status=$STATUS fail_count=$FAIL_COUNT pending=${PENDING_SMS:-none}${GATEWAY_OK_URL:+ gw=$GATEWAY_OK_URL})"
  need_up_sms=0
  if [[ "$STATUS" == "down" || "$PENDING_SMS" == "up" ]]; then
    need_up_sms=1
  fi
  if [[ "$need_up_sms" -eq 1 ]]; then
    log "recovery — sending SMS وصل"
    if notify_admins_sms "وصل" "سامانه دوباره در دسترس است"; then
      write_state "up" 0
      exit 0
    fi
    warn "SMS وصل ناموفق — state=down می‌ماند تا cron بعدی دوباره تلاش کند"
    write_state "down" 0 "up"
    exit 1
  fi
  write_state "up" 0
  exit 0
fi

# probe failed and/or disk critically full
PROBE_FAILED=1
FAIL_COUNT=$((FAIL_COUNT + 1))
# Disk-full outages must alert on first tick: state may not persist on a full /
effective_threshold="$threshold"
if [[ "$DISK_CRITICAL" -eq 1 ]]; then
  effective_threshold=1
fi
log "probe FAILED (${PROBE_REASON:-unknown}) fail_count=$FAIL_COUNT/$effective_threshold (prev=$STATUS pending=${PENDING_SMS:-none})"

if [[ "$STATUS" == "down" ]]; then
  # Still down; retry pending «قطع» SMS if previous send failed
  if [[ "$PENDING_SMS" == "down" ]]; then
    log "retry SMS قطع"
    if notify_admins_sms "قطع" "سامانه از دسترس خارج شد (${PROBE_REASON:-down})"; then
      write_state "down" "$FAIL_COUNT"
    else
      write_state "down" "$FAIL_COUNT" "down"
    fi
  else
    write_state "down" "$FAIL_COUNT"
  fi
  exit 0
fi

# currently considered up (or first run)
if (( FAIL_COUNT >= effective_threshold )); then
  log "threshold reached — sending SMS قطع"
  if notify_admins_sms "قطع" "سامانه از دسترس خارج شد (${PROBE_REASON:-down})"; then
    write_state "down" "$FAIL_COUNT"
  else
    warn "SMS قطع ناموفق — pending_sms=down برای retry"
    write_state "down" "$FAIL_COUNT" "down"
  fi
  exit 0
fi

write_state "up" "$FAIL_COUNT"
exit 0
