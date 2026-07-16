#!/usr/bin/env bash
# Post-deploy health check + SMS alert to admins on failure.
#
# Called from deploy.sh. Does not depend on Nest being healthy for SMS
# (calls sms.ir / Kavenegar directly from .env).
#
# Env (optional):
#   SKIP_HEALTH_CHECK=1          — skip entirely
#   SMS_DEPLOY_ALERT_ENABLED=0   — health-check only, no SMS (default: 1)
#   HEALTH_TIMEOUT_SEC=90        — wait for API (default 90)
#   HEALTH_URL                   — override (default http://127.0.0.1:3000/api/v1/health)
#   GATEWAY_URL                  — default http://127.0.0.1:80/
#   CHECK_GATEWAY=1              — also probe gateway (default 1)
#
# Reuses from .env / admin settings env file:
#   SMS_ADMIN_LOGIN_ALERT_RECIPIENTS
#   ACTIVE_SMS_PROVIDER / SMS_IR_API_KEY / KAVENEGAR_API_KEY
#   SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID (sms.ir)
#   SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER (default PHONE)
#   SMS_ADMIN_LOGIN_ALERT_TEMPLATE_NAME (kavenegar lookup — optional; else plain send)
set -euo pipefail

ROOT="${ROOT:-/app/tabagheh}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
SKIP_HEALTH_CHECK="${SKIP_HEALTH_CHECK:-0}"
SMS_DEPLOY_ALERT_ENABLED="${SMS_DEPLOY_ALERT_ENABLED:-1}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-90}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/v1/health}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:80/}"
CHECK_GATEWAY="${CHECK_GATEWAY:-1}"

log() { echo "[post-deploy] $*"; }
warn() { echo "[post-deploy] WARN: $*" >&2; }

if [[ "$SKIP_HEALTH_CHECK" == "1" ]]; then
  log "SKIP_HEALTH_CHECK=1 — skipping"
  exit 0
fi

# Load .env keys we need (safe: no eval of arbitrary values into shell logic beyond assignment)
load_env_var() {
  local key="$1"
  local line
  [[ -f "$ENV_FILE" ]] || return 0
  line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 || true)"
  [[ -n "$line" ]] || return 0
  printf '%s' "${line#*=}" | sed 's/^["'\'']//; s/["'\'']$//'
}

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
    sleep 2
  done
  log "$label FAILED after ${HEALTH_TIMEOUT_SEC}s"
  return 1
}

send_sms_kavenegar() {
  local api_key="$1"
  local mobile="$2"
  local message="$3"
  local template_name="$4"
  if [[ -n "$template_name" ]]; then
    curl -sS --max-time 20 -G \
      "https://api.kavenegar.com/v1/${api_key}/verify/lookup.json" \
      --data-urlencode "receptor=${mobile}" \
      --data-urlencode "template=${template_name}" \
      --data-urlencode "token=${message}" >/dev/null 2>&1 \
      && return 0
  fi
  curl -sS --max-time 20 -X POST \
    "https://api.kavenegar.com/v1/${api_key}/sms/send.json" \
    --data-urlencode "receptor=${mobile}" \
    --data-urlencode "message=${message}" >/dev/null 2>&1
}

send_sms_smsir() {
  local api_key="$1"
  local mobile="$2"
  local message="$3"
  local template_id="$4"
  local param_name="$5"
  if [[ -z "$template_id" || "$template_id" == "0" ]]; then
    warn "sms.ir: no SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID — cannot send deploy alert"
    return 1
  fi
  # Reuse verify template; put short error text in the configured parameter slot
  local payload
  payload="$(printf '{"mobile":"%s","templateId":%s,"parameters":[{"name":"%s","value":"%s"}]}' \
    "$mobile" "$template_id" "$param_name" "$message")"
  curl -sS --max-time 20 -X POST "https://api.sms.ir/v1/send/verify" \
    -H "X-API-KEY: ${api_key}" \
    -H "Content-Type: application/json" \
    -H "Accept: text/plain" \
    -d "$payload" >/dev/null 2>&1
}

notify_admins_sms() {
  local reason="$1"
  if [[ "$SMS_DEPLOY_ALERT_ENABLED" == "0" || "$SMS_DEPLOY_ALERT_ENABLED" == "false" ]]; then
    warn "SMS_DEPLOY_ALERT_ENABLED=0 — not sending SMS"
    return 0
  fi

  local recipients_raw provider api_key template_id template_name param_name
  recipients_raw="$(load_env_var SMS_ADMIN_LOGIN_ALERT_RECIPIENTS)"
  if [[ -z "${recipients_raw// /}" ]]; then
    warn "SMS_ADMIN_LOGIN_ALERT_RECIPIENTS empty — cannot SMS admins"
    return 0
  fi

  provider="$(load_env_var ACTIVE_SMS_PROVIDER)"
  provider="$(echo "${provider:-smsir}" | tr '[:upper:]' '[:lower:]')"
  template_id="$(load_env_var SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID)"
  template_id="${template_id:-176584}"
  template_name="$(load_env_var SMS_ADMIN_LOGIN_ALERT_TEMPLATE_NAME)"
  param_name="$(load_env_var SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER)"
  param_name="${param_name:-PHONE}"

  # Keep SMS param short (templates often truncate)
  local short
  short="$(echo "$reason" | tr '\n' ' ' | cut -c1-80)"
  local stamp
  stamp="$(date '+%m/%d %H:%M')"
  local msg="DeployFail ${stamp}: ${short}"

  local -a mobiles=()
  mapfile -t mobiles < <(parse_recipients "$recipients_raw")
  if [[ ${#mobiles[@]} -eq 0 ]]; then
    warn "no valid admin mobiles parsed"
    return 0
  fi

  log "sending deploy-failure SMS to ${#mobiles[@]} admin(s) via ${provider}..."
  local ok=0
  local m
  for m in "${mobiles[@]}"; do
    if [[ "$provider" == "kavenegar" ]]; then
      api_key="$(load_env_var KAVENEGAR_API_KEY)"
      [[ -n "$api_key" ]] || { warn "KAVENEGAR_API_KEY missing"; return 0; }
      if send_sms_kavenegar "$api_key" "$m" "$msg" "$template_name"; then
        ok=$((ok + 1))
      else
        warn "Kavenegar send failed for $m"
      fi
    else
      api_key="$(load_env_var SMS_IR_API_KEY)"
      [[ -n "$api_key" ]] || { warn "SMS_IR_API_KEY missing"; return 0; }
      if send_sms_smsir "$api_key" "$m" "$msg" "$template_id" "$param_name"; then
        ok=$((ok + 1))
      else
        warn "sms.ir send failed for $m"
      fi
    fi
  done
  log "SMS attempted: ${ok}/${#mobiles[@]}"
}

# --- run checks ---
failures=()

if ! wait_for_health "$HEALTH_URL" "API health"; then
  failures+=("API health ($HEALTH_URL)")
fi

if [[ "$CHECK_GATEWAY" == "1" ]]; then
  if curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "$GATEWAY_URL" 2>/dev/null | grep -qE '^2|^3'; then
    log "gateway OK ($GATEWAY_URL)"
  else
    # soft warn only if frontend wasn't the only deploy — still count as failure when API is up but site 502
    failures+=("gateway ($GATEWAY_URL)")
    log "gateway FAILED ($GATEWAY_URL)"
  fi
fi

if [[ ${#failures[@]} -eq 0 ]]; then
  log "all checks passed"
  exit 0
fi

reason="$(IFS='; '; echo "${failures[*]}")"
log "ERROR: post-deploy checks failed: $reason"
notify_admins_sms "$reason"
exit 1
