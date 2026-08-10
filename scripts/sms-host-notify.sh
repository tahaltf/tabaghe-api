#!/usr/bin/env bash
# Shared SMS notify helpers for host scripts (post-deploy, uptime monitor).
# Source after: ROOT, log(), warn(), load_env_var(), json_escape() are defined.

_sms_resolve_deploy_notify_token() {
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

# POST to /api/v1/health/{endpoint} inside API container.
# Prints response body to stdout.
# Exit: 0 = sent>=1, 2 = API JSON with recipients (sent=0), 1 = failure
_sms_exec_health_post() {
  local svc="$1"
  local endpoint="$2"
  local payload="$3"
  local token="$4"
  local url="http://127.0.0.1:3000/api/v1/health/${endpoint}"
  local out=""

  # wget first (Alpine/BusyBox)
  if docker compose exec -T "$svc" sh -c 'command -v wget' >/dev/null 2>&1; then
    out="$(
      docker compose exec -T \
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
            --post-data="$P" "$U" 2>/dev/null || true
        ' 2>/dev/null || true
    )"
    if [[ -n "$out" ]]; then
      printf '%s' "$out"
      echo "$out" | grep -qE '"sent"[[:space:]]*:[[:space:]]*[1-9]' && return 0
      echo "$out" | grep -qE '"recipients"[[:space:]]*:' && return 2
    fi
  fi

  # curl
  if docker compose exec -T "$svc" sh -c 'command -v curl' >/dev/null 2>&1; then
    if [[ -n "$token" ]]; then
      out="$(docker compose exec -T "$svc" curl -sS --max-time 25 \
        -X POST "$url" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -H "X-Deploy-Notify-Token: ${token}" \
        -d "$payload" 2>/dev/null || true)"
    else
      out="$(docker compose exec -T "$svc" curl -sS --max-time 25 \
        -X POST "$url" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d "$payload" 2>/dev/null || true)"
    fi
    if [[ -n "$out" ]]; then
      printf '%s' "$out"
      echo "$out" | grep -qE '"sent"[[:space:]]*:[[:space:]]*[1-9]' && return 0
      echo "$out" | grep -qE '"recipients"[[:space:]]*:' && return 2
    fi
  fi

  # node fetch
  out="$(
    docker compose exec -T \
      -e "U=${url}" \
      -e "P=${payload}" \
      -e "T=${token}" \
      "$svc" \
      node -e 'const h={"Content-Type":"application/json","Accept":"application/json"};if(process.env.T)h["X-Deploy-Notify-Token"]=process.env.T;fetch(process.env.U,{method:"POST",headers:h,body:process.env.P}).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))' \
      2>/dev/null || true
  )"
  if [[ -n "$out" ]]; then
    printf '%s' "$out"
    echo "$out" | grep -qE '"sent"[[:space:]]*:[[:space:]]*[1-9]' && return 0
    echo "$out" | grep -qE '"recipients"[[:space:]]*:' && return 2
  fi

  return 1
}

# endpoint: deploy-sms-alert | uptime-sms-alert
# Returns 0 on sent>=1, 1 on total failure, 2 on API reached but sent=0
sms_notify_via_api() {
  local endpoint="$1"
  local status_fa="$2"
  local detail="$3"
  local status_esc detail_esc payload token resp svc attempt api_rc

  status_esc="$(json_escape "$status_fa")"
  detail_esc="$(json_escape "$detail")"
  payload="$(printf '{"status":"%s","detail":"%s"}' "$status_esc" "$detail_esc")"
  token="$(_sms_resolve_deploy_notify_token)"

  cd "$ROOT" 2>/dev/null || true
  for attempt in 1 2; do
    for svc in backend tabagheh-api; do
      if ! docker compose ps --status running "$svc" >/dev/null 2>&1; then
        continue
      fi
      log "SMS via API ($endpoint) service=$svc attempt=$attempt ..."
      resp=""
      api_rc=1
      if resp="$(_sms_exec_health_post "$svc" "$endpoint" "$payload" "$token")"; then
        api_rc=0
      else
        api_rc=$?
      fi

      if [[ "$api_rc" -eq 0 ]]; then
        log "SMS via API OK: $(echo "$resp" | tr '\n' ' ' | cut -c1-200)"
        return 0
      fi
      if [[ "$api_rc" -eq 2 ]]; then
        local reason
        reason="$(echo "$resp" | grep -oE '"reason"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 || true)"
        warn "API $endpoint پاسخ داد ولی ارسال نشد${reason:+ ($reason)}: $(echo "$resp" | tr '\n' ' ' | cut -c1-240)"
        return 2
      fi
      warn "API $endpoint ($svc) — پاسخ نامعتبر: $(echo "$resp" | tr '\n' ' ' | cut -c1-200)"
    done
    if [[ "$attempt" -eq 1 ]]; then
      warn "SMS API retry in 5s..."
      sleep 5
    fi
  done
  return 1
}
