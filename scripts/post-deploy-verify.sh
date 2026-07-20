#!/usr/bin/env bash
# Post-deploy health check + SMS to admins (success OR failure).
#
# sms.ir verify format (same as OTP / admin login):
#   POST /v1/send/verify
#   { "mobile", "templateId", "parameters": [{ "name", "value" }, ...] }
#
# Template example in sms.ir panel:
#   دیپلوی طبقه: #STATUS
#   جزئیات: #DETAIL
#
# Env:
#   SKIP_HEALTH_CHECK=1
#   SMS_DEPLOY_ALERT_ENABLED=0|1          (default 1)
#   HEALTH_TIMEOUT_SEC=90
#   HEALTH_URL / GATEWAY_URL / CHECK_GATEWAY
#
# SMS (prefer panel via API; .env is fallback when API is down):
#   ACTIVE_SMS_PROVIDER=smsir
#   SMS_IR_API_KEY=...
#   SMS_IR_LINE_NUMBER=3000...              (optional plain-SMS fallback if no template)
#   SMS_DEPLOY_ALERT_RECIPIENTS=09...,09...   (fallback: SMS_ADMIN_LOGIN_ALERT_RECIPIENTS)
#   SMS_DEPLOY_ALERT_TEMPLATE_ID=123456       (sms.ir template with #STATUS #DETAIL)
#   SMS_DEPLOY_ALERT_STATUS_PARAMETER=STATUS  (default STATUS)
#   SMS_DEPLOY_ALERT_DETAIL_PARAMETER=DETAIL  (default DETAIL; empty = only STATUS)
#   SMS_DEPLOY_ALERT_TEMPLATE_NAME=...        (kavenegar lookup name; token=STATUS, token2=DETAIL)
#   DEPLOY_NOTIFY_TOKEN=...                   (optional; required if calling API from non-localhost)
set -euo pipefail

ROOT="${ROOT:-/app/tabagheh}"
SKIP_HEALTH_CHECK="${SKIP_HEALTH_CHECK:-0}"
SMS_DEPLOY_ALERT_ENABLED="${SMS_DEPLOY_ALERT_ENABLED:-1}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-90}"
CHECK_GATEWAY="${CHECK_GATEWAY:-1}"

log() { echo "[post-deploy] $*"; }
warn() { echo "[post-deploy] WARN: $*" >&2; }

# Production server uses ./api/.env (compose env_file); monorepo may use root .env.
# Search all candidates; first non-empty value for each key wins (ENV_FILE first if set).
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

if [[ ${#ENV_FILES[@]} -eq 0 ]]; then
  warn "هیچ فایل .env پیدا نشد (ROOT=$ROOT)"
else
  log "env files: ${ENV_FILES[*]}"
fi

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

# Host often cannot resolve api.sms.ir (compose uses extra_hosts). Mirror that for host curl.
SMS_IR_HOST_IP="$(load_env_var SMS_IR_HOST_IP)"
SMS_IR_HOST_IP="${SMS_IR_HOST_IP:-185.211.56.44}"

curl_smsir() {
  # usage: curl_smsir [curl args...]
  curl -sS --max-time 20 --resolve "api.sms.ir:443:${SMS_IR_HOST_IP}" "$@"
}

# API is not published on the host (only gateway :80). Prefer gateway health URL.
_http_port="$(load_env_var HTTP_PORT)"
_http_port="${_http_port:-80}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${_http_port}/api/v1/health}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:${_http_port}/}"

if [[ "$SKIP_HEALTH_CHECK" == "1" ]]; then
  log "SKIP_HEALTH_CHECK=1 — skipping"
  exit 0
fi

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
    local seen=0
    local x
    for x in "${out[@]+"${out[@]}"}"; do
      [[ "$x" == "$norm" ]] && seen=1 && break
    done
    [[ "$seen" -eq 1 ]] && continue
    out+=("$norm")
  done
  printf '%s\n' "${out[@]+"${out[@]}"}"
}

json_escape() {
  # Prefer python for correct UTF-8 / quotes
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
  local code
  code="$(curl -sS -o /tmp/tabagheh-health-body.$$ -w '%{http_code}' --max-time 8 "$url" 2>/dev/null || echo 000)"
  if [[ "$code" =~ ^2 ]]; then
    if [[ "$url" == *"/health"* ]]; then
      if grep -qE '"ok"[[:space:]]*:[[:space:]]*true|"status"[[:space:]]*:[[:space:]]*"up"' /tmp/tabagheh-health-body.$$ 2>/dev/null; then
        rm -f /tmp/tabagheh-health-body.$$
        return 0
      fi
      rm -f /tmp/tabagheh-health-body.$$
      return 1
    fi
    rm -f /tmp/tabagheh-health-body.$$
    return 0
  fi
  rm -f /tmp/tabagheh-health-body.$$
  return 1
}

# Fallback when host cannot reach API (port 3000 not published): curl inside container
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

wait_for_health() {
  local url="$1"
  local label="$2"
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))
  local n=0
  log "waiting for $label ($url) up to ${HEALTH_TIMEOUT_SEC}s..."
  while (( SECONDS < deadline )); do
    n=$((n + 1))
    if http_ok "$url"; then
      log "$label OK (attempt $n)"
      return 0
    fi
    # Host URL often fails for API (expose-only); try in-container after a few attempts
    if [[ "$label" == "API health" ]] && (( n >= 3 )) && api_health_via_docker; then
      log "$label OK via docker exec (attempt $n)"
      return 0
    fi
    sleep 2
  done
  log "$label FAILED after ${HEALTH_TIMEOUT_SEC}s"
  return 1
}

# Prefer Nest endpoint (reads panel SystemSetting + encrypted SMS keys).
# Called from inside API container so loopback auth works.
notify_via_api() {
  local status_fa="$1"
  local detail="$2"
  local status_esc detail_esc payload token hdr_args resp svc

  status_esc="$(json_escape "$status_fa")"
  detail_esc="$(json_escape "$detail")"
  payload="$(printf '{"status":"%s","detail":"%s"}' "$status_esc" "$detail_esc")"
  token="$(load_env_var DEPLOY_NOTIFY_TOKEN)"

  cd "$ROOT" 2>/dev/null || true
  for svc in backend tabagheh-api; do
    if ! docker compose ps --status running "$svc" >/dev/null 2>&1; then
      continue
    fi
    if [[ -n "$token" ]]; then
      resp="$(docker compose exec -T "$svc" curl -sS --max-time 25 \
        -X POST "http://127.0.0.1:3000/api/v1/health/deploy-sms-alert" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -H "X-Deploy-Notify-Token: ${token}" \
        -d "$payload" 2>&1)" || true
    else
      resp="$(docker compose exec -T "$svc" curl -sS --max-time 25 \
        -X POST "http://127.0.0.1:3000/api/v1/health/deploy-sms-alert" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d "$payload" 2>&1)" || true
    fi
    if echo "$resp" | grep -qE '"sent"[[:space:]]*:[[:space:]]*[1-9]'; then
      log "SMS via API (panel settings): $(echo "$resp" | tr '\n' ' ' | cut -c1-160)"
      return 0
    fi
    if echo "$resp" | grep -qE '"recipients"[[:space:]]*:'; then
      warn "API deploy-sms-alert پاسخ داد ولی ارسال نشد: $(echo "$resp" | tr '\n' ' ' | cut -c1-200)"
      return 1
    fi
    warn "API deploy-sms-alert ($svc): $(echo "$resp" | tr '\n' ' ' | cut -c1-200)"
  done
  return 1
}

# sms.ir verify — parameters: STATUS (+ optional DETAIL)
send_sms_smsir_verify() {
  local api_key="$1"
  local mobile="$2"
  local template_id="$3"
  local status_name="$4"
  local status_value="$5"
  local detail_name="$6"
  local detail_value="$7"

  if [[ -z "$template_id" || "$template_id" == "0" ]]; then
    return 1
  fi

  local status_esc detail_esc payload
  status_esc="$(json_escape "$status_value")"
  if [[ -n "$detail_name" ]]; then
    detail_esc="$(json_escape "$detail_value")"
    payload="$(printf '{"mobile":"%s","templateId":%s,"parameters":[{"name":"%s","value":"%s"},{"name":"%s","value":"%s"}]}' \
      "$mobile" "$template_id" "$status_name" "$status_esc" "$detail_name" "$detail_esc")"
  else
    payload="$(printf '{"mobile":"%s","templateId":%s,"parameters":[{"name":"%s","value":"%s"}]}' \
      "$mobile" "$template_id" "$status_name" "$status_esc")"
  fi

  local resp
  resp="$(curl_smsir -X POST "https://api.sms.ir/v1/send/verify" \
    -H "X-API-KEY: ${api_key}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$payload" 2>&1)" || true
  if echo "$resp" | grep -qE '"status"[[:space:]]*:[[:space:]]*1'; then
    return 0
  fi
  warn "sms.ir verify response: $(echo "$resp" | tr '\n' ' ' | cut -c1-200)"
  return 1
}

# Plain text via line number when no deploy template is configured
send_sms_smsir_bulk() {
  local api_key="$1"
  local mobile="$2"
  local line_number="$3"
  local message="$4"

  if [[ -z "$line_number" ]]; then
    return 1
  fi

  local msg_esc payload resp
  msg_esc="$(json_escape "$message")"
  payload="$(printf '{"lineNumber":%s,"messageText":"%s","mobiles":["%s"],"sendDateTime":null}' \
    "$line_number" "$msg_esc" "$mobile")"

  resp="$(curl_smsir -X POST "https://api.sms.ir/v1/send/bulk" \
    -H "X-API-KEY: ${api_key}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$payload" 2>&1)" || true
  if echo "$resp" | grep -qE '"status"[[:space:]]*:[[:space:]]*1'; then
    return 0
  fi
  warn "sms.ir bulk response: $(echo "$resp" | tr '\n' ' ' | cut -c1-200)"
  return 1
}

send_sms_kavenegar() {
  local api_key="$1"
  local mobile="$2"
  local template_name="$3"
  local status_value="$4"
  local detail_value="$5"

  if [[ -n "$template_name" ]]; then
    curl -sS --max-time 20 -G \
      "https://api.kavenegar.com/v1/${api_key}/verify/lookup.json" \
      --data-urlencode "receptor=${mobile}" \
      --data-urlencode "template=${template_name}" \
      --data-urlencode "token=${status_value}" \
      --data-urlencode "token2=${detail_value}" >/dev/null 2>&1 \
      && return 0
  fi
  local msg="دیپلوی طبقه: ${status_value} — ${detail_value}"
  curl -sS --max-time 20 -X POST \
    "https://api.kavenegar.com/v1/${api_key}/sms/send.json" \
    --data-urlencode "receptor=${mobile}" \
    --data-urlencode "message=${msg}" >/dev/null 2>&1
}

# status_fa: موفق | ناموفق
# detail: short ASCII/Persian detail for second template param
notify_admins_sms() {
  local status_fa="$1"
  local detail="$2"

  local enabled_env
  enabled_env="$(load_env_var SMS_DEPLOY_ALERT_ENABLED)"
  enabled_env="${enabled_env:-$SMS_DEPLOY_ALERT_ENABLED}"
  if [[ "$enabled_env" == "0" || "$enabled_env" == "false" ]]; then
    warn "SMS_DEPLOY_ALERT_ENABLED=0 — SMS ارسال نشد"
    return 0
  fi

  # 1) Panel-driven path (DB settings + panel secrets)
  if notify_via_api "$status_fa" "$detail"; then
    return 0
  fi
  warn "ارسال از API/پنل ناموفق — fallback به .env"

  local recipients_raw
  recipients_raw="$(load_env_var SMS_DEPLOY_ALERT_RECIPIENTS)"
  if [[ -z "${recipients_raw// /}" ]]; then
    recipients_raw="$(load_env_var SMS_ADMIN_LOGIN_ALERT_RECIPIENTS)"
  fi
  if [[ -z "${recipients_raw// /}" ]]; then
    warn "SMS ارسال نشد: SMS_DEPLOY_ALERT_RECIPIENTS را در پنل (پیامک ورود و دیپلوی) یا api/.env بگذارید"
    return 0
  fi

  local provider
  provider="$(load_env_var ACTIVE_SMS_PROVIDER)"
  provider="$(echo "${provider:-smsir}" | tr '[:upper:]' '[:lower:]')"

  local template_id template_name status_param detail_param line_number
  # Do NOT fall back to admin-login template — that uses #PHONE, not #STATUS/#DETAIL
  template_id="$(load_env_var SMS_DEPLOY_ALERT_TEMPLATE_ID)"
  template_name="$(load_env_var SMS_DEPLOY_ALERT_TEMPLATE_NAME)"
  line_number="$(load_env_var SMS_IR_LINE_NUMBER)"
  status_param="$(load_env_var SMS_DEPLOY_ALERT_STATUS_PARAMETER)"
  status_param="${status_param:-STATUS}"
  detail_param="$(load_env_var SMS_DEPLOY_ALERT_DETAIL_PARAMETER)"
  detail_param="${detail_param:-DETAIL}"

  # sms.ir often limits param length
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
    warn "شماره ادمین معتبر پیدا نشد (raw=$recipients_raw)"
    return 0
  fi

  if [[ "$provider" != "kavenegar" ]]; then
    if [[ -z "$template_id" || "$template_id" == "0" ]] && [[ -z "$line_number" ]]; then
      warn "SMS ارسال نشد: SMS_DEPLOY_ALERT_TEMPLATE_ID (قالب با #STATUS و #DETAIL) را در پنل یا api/.env ست کنید"
      return 0
    fi
  fi

  log "ارسال SMS دیپلوی (وضعیت=${status_fa}) به ${#mobiles[@]} ادمین via ${provider} (.env fallback)..."
  local ok=0 m api_key plain_msg
  plain_msg="دیپلوی طبقه: ${status_fa} — ${detail}"
  for m in "${mobiles[@]}"; do
    if [[ "$provider" == "kavenegar" ]]; then
      api_key="$(load_env_var KAVENEGAR_API_KEY)"
      [[ -n "$api_key" ]] || { warn "KAVENEGAR_API_KEY missing"; return 0; }
      if send_sms_kavenegar "$api_key" "$m" "$template_name" "$status_fa" "$detail"; then
        ok=$((ok + 1))
      else
        warn "Kavenegar failed for $m"
      fi
    else
      api_key="$(load_env_var SMS_IR_API_KEY)"
      [[ -n "$api_key" ]] || { warn "SMS_IR_API_KEY missing (در پنل کلیدهای سرور یا api/.env)"; return 0; }
      if [[ -n "$template_id" && "$template_id" != "0" ]] \
        && send_sms_smsir_verify "$api_key" "$m" "$template_id" \
          "$status_param" "$status_fa" "$detail_param" "$detail"; then
        ok=$((ok + 1))
      elif send_sms_smsir_bulk "$api_key" "$m" "$line_number" "$plain_msg"; then
        ok=$((ok + 1))
      else
        warn "sms.ir failed for $m (template_id=${template_id:-empty} line=${line_number:-empty})"
      fi
    fi
  done
  log "SMS: ${ok}/${#mobiles[@]} ارسال شد"
  if [[ "$ok" -eq 0 ]]; then
    warn "هیچ SMS دیپلوی ارسال نشد — لاگ بالا و پنل sms.ir را چک کنید"
  fi
}

# --- run checks ---
failures=()

if ! wait_for_health "$HEALTH_URL" "API health"; then
  failures+=("API")
fi

if [[ "$CHECK_GATEWAY" == "1" ]]; then
  if curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "$GATEWAY_URL" 2>/dev/null | grep -qE '^2|^3'; then
    log "gateway OK ($GATEWAY_URL)"
  else
    failures+=("Gateway")
    log "gateway FAILED ($GATEWAY_URL)"
  fi
fi

if [[ ${#failures[@]} -eq 0 ]]; then
  log "all checks passed"
  notify_admins_sms "موفق" "API+Gateway OK"
  exit 0
fi

reason="$(IFS=+; echo "${failures[*]}")"
log "ERROR: post-deploy checks failed: $reason"
notify_admins_sms "ناموفق" "$reason"
exit 1
