#!/usr/bin/env bash
# Uptime monitor — probe health/gateway and SMS admins on state change only.
#
# Install on server (every 5 minutes):
#   mkdir -p /app/tabagheh/logs
#   crontab -e
#   */5 * * * * ROOT=/app/tabagheh bash /app/tabagheh/api/scripts/uptime-monitor.sh >> /app/tabagheh/logs/uptime-monitor.log 2>&1
#
# Behavior:
#   - UP → 2 consecutive failures → SMS «قطع» (once)
#   - DOWN → keep probing, no repeat SMS
#   - DOWN → first success → SMS «وصل» (once)
#
# Env:
#   UPTIME_MONITOR_ENABLED=0|1     (default 1; host kill-switch)
#   UPTIME_FAIL_THRESHOLD=2        (consecutive fails before DOWN)
#   CHECK_GATEWAY=1
#   HEALTH_URL / GATEWAY_URL
#   SMS_UPTIME_ALERT_ENABLED=0|1   (.env fallback when API down; panel preferred via API)
#   SMS_UPTIME_ALERT_RECIPIENTS=... (fallback: SMS_DEPLOY / SMS_ADMIN_LOGIN recipients)
#   SMS_DEPLOY_ALERT_TEMPLATE_*    (same #STATUS #DETAIL template as deploy)
#   DEPLOY_NOTIFY_TOKEN=...        (optional)
#
set -euo pipefail

ROOT="${ROOT:-/app/tabagheh}"
UPTIME_MONITOR_ENABLED="${UPTIME_MONITOR_ENABLED:-1}"
UPTIME_FAIL_THRESHOLD="${UPTIME_FAIL_THRESHOLD:-2}"
CHECK_GATEWAY="${CHECK_GATEWAY:-1}"
STATE_FILE="${UPTIME_STATE_FILE:-$ROOT/.uptime-monitor-state}"

log() { echo "[uptime $(date '+%Y-%m-%d %H:%M:%S')] $*"; }
warn() { echo "[uptime $(date '+%Y-%m-%d %H:%M:%S')] WARN: $*" >&2; }

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
_http_port="${_http_port:-80}"
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

probe_site() {
  local failures=()
  if http_ok "$HEALTH_URL" || api_health_via_docker; then
    :
  else
    failures+=("API")
  fi
  if [[ "$CHECK_GATEWAY" == "1" ]]; then
    if curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "$GATEWAY_URL" 2>/dev/null | grep -qE '^2|^3'; then
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

read_state() {
  STATUS="up"
  FAIL_COUNT=0
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    # status=up|down and fail_count=N
    STATUS="$(grep -E '^status=' "$STATE_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    FAIL_COUNT="$(grep -E '^fail_count=' "$STATE_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  fi
  [[ "$STATUS" == "down" ]] || STATUS="up"
  [[ "$FAIL_COUNT" =~ ^[0-9]+$ ]] || FAIL_COUNT=0
}

write_state() {
  local st="$1"
  local fc="$2"
  printf 'status=%s\nfail_count=%s\nupdated=%s\n' "$st" "$fc" "$(date -Iseconds 2>/dev/null || date)" > "$STATE_FILE"
}

_resolve_deploy_notify_token() {
  local token svc
  token="$(load_env_var DEPLOY_NOTIFY_TOKEN)"
  if [[ -n "$token" ]]; then
    printf '%s' "$token"
    return 0
  fi
  cd "$ROOT" 2>/dev/null || true
  for svc in backend tabagheh-api; do
    if ! docker compose ps --status running "$svc" >/dev/null 2>&1; then
      continue
    fi
    token="$(
      docker compose exec -T "$svc" printenv DEPLOY_NOTIFY_TOKEN 2>/dev/null \
        | tr -d '\r\n' || true
    )"
    if [[ -n "$token" ]]; then
      printf '%s' "$token"
      return 0
    fi
  done
  return 0
}

_exec_api_post() {
  local svc="$1"
  local payload="$2"
  local token="$3"
  local url="http://127.0.0.1:3000/api/v1/health/uptime-sms-alert"

  if docker compose exec -T \
    -e "U=${url}" \
    -e "P=${payload}" \
    -e "T=${token}" \
    "$svc" \
    node -e 'const h={"Content-Type":"application/json","Accept":"application/json"};if(process.env.T)h["X-Deploy-Notify-Token"]=process.env.T;fetch(process.env.U,{method:"POST",headers:h,body:process.env.P}).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(e=>{process.stderr.write(String(e));process.exit(1)})' \
    2>/dev/null; then
    return 0
  fi

  if docker compose exec -T "$svc" sh -c 'command -v wget' >/dev/null 2>&1; then
    if docker compose exec -T \
      -e "P=${payload}" \
      -e "T=${token}" \
      -e "U=${url}" \
      "$svc" sh -c '
        HDR_T=""
        [ -n "$T" ] && HDR_T="--header=X-Deploy-Notify-Token: $T"
        wget -qO- --timeout=25 \
          --header="Content-Type: application/json" \
          --header="Accept: application/json" \
          $HDR_T \
          --post-data="$P" "$U"
      ' 2>/dev/null; then
      return 0
    fi
  fi

  if docker compose exec -T "$svc" sh -c 'command -v curl' >/dev/null 2>&1; then
    if [[ -n "$token" ]]; then
      docker compose exec -T "$svc" curl -sS --max-time 25 \
        -X POST "$url" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -H "X-Deploy-Notify-Token: ${token}" \
        -d "$payload" 2>/dev/null && return 0
    else
      docker compose exec -T "$svc" curl -sS --max-time 25 \
        -X POST "$url" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d "$payload" 2>/dev/null && return 0
    fi
  fi
  return 1
}

notify_via_api() {
  local status_fa="$1"
  local detail="$2"
  local status_esc detail_esc payload token resp svc

  status_esc="$(json_escape "$status_fa")"
  detail_esc="$(json_escape "$detail")"
  payload="$(printf '{"status":"%s","detail":"%s"}' "$status_esc" "$detail_esc")"
  token="$(_resolve_deploy_notify_token)"

  cd "$ROOT" 2>/dev/null || true
  for svc in backend tabagheh-api; do
    if ! docker compose ps --status running "$svc" >/dev/null 2>&1; then
      continue
    fi
    resp="$(_exec_api_post "$svc" "$payload" "$token")" || true
    if echo "$resp" | grep -qE '"sent"[[:space:]]*:[[:space:]]*[1-9]'; then
      log "SMS via API: $(echo "$resp" | tr '\n' ' ' | cut -c1-160)"
      return 0
    fi
    if echo "$resp" | grep -qE '"recipients"[[:space:]]*:'; then
      warn "API uptime-sms-alert پاسخ داد ولی ارسال نشد: $(echo "$resp" | tr '\n' ' ' | cut -c1-200)"
      return 2
    fi
    warn "API uptime-sms-alert ($svc) نامعتبر: $(echo "$resp" | tr '\n' ' ' | cut -c1-160)"
  done
  return 1
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

notify_admins_sms() {
  local status_fa="$1"
  local detail="$2"

  local api_rc=0
  if notify_via_api "$status_fa" "$detail"; then
    return 0
  else
    api_rc=$?
  fi
  if [[ "$api_rc" -eq 2 ]]; then
    warn "پنل در دسترس بود ولی SMS ارسال نشد — بدون fallback"
    return 0
  fi
  warn "ارسال از API ناموفق — fallback به .env"

  local enabled_env
  enabled_env="$(load_env_var SMS_UPTIME_ALERT_ENABLED)"
  enabled_env="${enabled_env:-1}"
  if [[ "$enabled_env" == "0" || "$enabled_env" == "false" ]]; then
    warn "SMS_UPTIME_ALERT_ENABLED=0 — fallback SMS ارسال نشد"
    return 0
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
    warn "SMS ارسال نشد: گیرنده در پنل یا .env ست نشده"
    return 0
  fi

  local provider template_id template_name status_param detail_param line_number
  provider="$(load_env_var ACTIVE_SMS_PROVIDER)"
  provider="$(echo "${provider:-smsir}" | tr '[:upper:]' '[:lower:]')"
  template_id="$(load_env_var SMS_DEPLOY_ALERT_TEMPLATE_ID)"
  template_name="$(load_env_var SMS_DEPLOY_ALERT_TEMPLATE_NAME)"
  line_number="$(load_env_var SMS_IR_LINE_NUMBER)"
  status_param="$(load_env_var SMS_DEPLOY_ALERT_STATUS_PARAMETER)"
  status_param="${status_param:-STATUS}"
  detail_param="$(load_env_var SMS_DEPLOY_ALERT_DETAIL_PARAMETER)"
  detail_param="${detail_param:-DETAIL}"

  detail="$(echo "$detail" | tr '\n' ' ' | cut -c1-70)"
  local stamp
  stamp="$(date '+%m/%d %H:%M')"
  if [[ -z "$detail" ]]; then
    detail="$stamp"
  else
    detail="${stamp} ${detail}"
  fi

  local -a mobiles=()
  mapfile -t mobiles < <(parse_recipients "$recipients_raw")
  if [[ ${#mobiles[@]} -eq 0 ]]; then
    warn "شماره معتبر پیدا نشد"
    return 0
  fi

  log "ارسال SMS uptime (وضعیت=${status_fa}) به ${#mobiles[@]} ادمین via ${provider} (.env)..."
  local ok=0 m api_key plain_msg
  plain_msg="سامانه طبقه: ${status_fa} — ${detail}"
  for m in "${mobiles[@]}"; do
    if [[ "$provider" == "kavenegar" ]]; then
      api_key="$(load_env_var KAVENEGAR_API_KEY)"
      [[ -n "$api_key" ]] || { warn "KAVENEGAR_API_KEY missing"; return 0; }
      if send_sms_kavenegar "$api_key" "$m" "$template_name" "$status_fa" "$detail"; then
        ok=$((ok + 1))
      fi
    else
      api_key="$(load_env_var SMS_IR_API_KEY)"
      [[ -n "$api_key" ]] || { warn "SMS_IR_API_KEY missing"; return 0; }
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
}

# --- main ---
read_state
PROBE_REASON=""

if probe_site; then
  log "probe OK (prev status=$STATUS fail_count=$FAIL_COUNT)"
  if [[ "$STATUS" == "down" ]]; then
    log "recovery — sending SMS وصل"
    notify_admins_sms "وصل" "سامانه دوباره در دسترس است" || true
  fi
  write_state "up" 0
  exit 0
fi

# probe failed
FAIL_COUNT=$((FAIL_COUNT + 1))
log "probe FAILED (${PROBE_REASON:-unknown}) fail_count=$FAIL_COUNT/$threshold (prev=$STATUS)"

if [[ "$STATUS" == "down" ]]; then
  write_state "down" "$FAIL_COUNT"
  exit 0
fi

# currently considered up (or first run)
if (( FAIL_COUNT >= threshold )); then
  log "threshold reached — sending SMS قطع"
  notify_admins_sms "قطع" "سامانه از دسترس خارج شد (${PROBE_REASON:-down})" || true
  write_state "down" "$FAIL_COUNT"
  exit 0
fi

write_state "up" "$FAIL_COUNT"
exit 0
