#!/usr/bin/env bash
set -euo pipefail
export LANG=C.UTF-8
export LC_ALL=C.UTF-8

BASE_DIR="/home/ubuntu/mono"
LOG_DIR="$BASE_DIR/monitor_logs"
STATE_FILE="$LOG_DIR/last_error_sig.txt"
CHAT_ID_FILE="$LOG_DIR/chat_id.txt"
TG_TOKEN="8779411469:AAHtHDlGG086Ccn4hOJ9PoH1hBte4I2lVHM"
HEALTH_URL="https://lingora.chat/healthz"

mkdir -p "$LOG_DIR"
TS="$(date '+%Y-%m-%d %H:%M:%S')"

ALERT_SIG_FILE="$LOG_DIR/last_alert_sig.txt"
ALERT_TS_FILE="$LOG_DIR/last_alert_ts.txt"
should_send_alert() {
  local msg="$1"
  local sig now prev_sig="" prev_ts="0"
  sig="$(echo "$msg" | sha1sum | awk '{print $1}')"
  now="$(date +%s)"
  [[ -f "$ALERT_SIG_FILE" ]] && prev_sig="$(cat "$ALERT_SIG_FILE")"
  [[ -f "$ALERT_TS_FILE" ]] && prev_ts="$(cat "$ALERT_TS_FILE")"
  if [[ "$sig" == "$prev_sig" ]] && [[ $((now - prev_ts)) -lt 600 ]]; then
    return 1
  fi
  echo "$sig" > "$ALERT_SIG_FILE"
  echo "$now" > "$ALERT_TS_FILE"
  return 0
}

discover_chat_id() {
  local cid=""
  if [[ -f "$CHAT_ID_FILE" ]]; then
    cid="$(cat "$CHAT_ID_FILE" | tr -d '[:space:]')"
  fi
  if [[ -n "$cid" ]]; then
    echo "$cid"; return 0
  fi
  local raw
  raw="$(curl -s "https://api.telegram.org/bot${TG_TOKEN}/getUpdates")"
  cid="$(echo "$raw" | grep -o '"chat":{[^}]*"id":[-0-9]*' | head -1 | grep -o '[-0-9]*$' || true)"
  if [[ -n "$cid" ]]; then
    echo "$cid" > "$CHAT_ID_FILE"
  fi
  echo "$cid"
}

send_tg() {
  local msg="$1"
  if ! should_send_alert "$msg"; then
    return 0
  fi
  local chat_id
  chat_id="$(discover_chat_id)"
  if [[ -z "$chat_id" ]]; then
    echo "[$TS] WARN: CHAT_ID not found. Send any message to bot first. msg=$msg" >> "$LOG_DIR/monitor.log"
    return 0
  fi
  curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=[MONO server alert] ${msg}" >/dev/null || true
}

check_openai_status() {
  local env_file="$BASE_DIR/.env"
  local key=""
  if [[ -f "$env_file" ]]; then
    key="$(grep -E '^OPENAI_API_KEY=' "$env_file" | head -1 | cut -d'=' -f2- | sed 's/^"//;s/"$//' | tr -d '\r' || true)"
  fi

  if [[ -z "$key" ]]; then
    send_tg "OpenAI API key missing - translation may stop"
    return 0
  fi

  local code
  code="$(curl -sS -o /tmp/mono_openai_resp.json -w "%{http_code}" \
    -H "Authorization: Bearer ${key}" \
    -H "Content-Type: application/json" \
    --max-time 15 \
    https://api.openai.com/v1/models || echo 000)"

  case "$code" in
    200) ;;
    401) send_tg "OpenAI API unauthorized (401) - key invalid/expired" ;;
    429) send_tg "OpenAI API rate limited (429) - translation may be delayed" ;;
    000) send_tg "OpenAI API no response - translation may stop" ;;
    *)   send_tg "OpenAI API error (${code}) - translation may stop" ;;
  esac
}

MONO_STATUS="$(pm2 jlist | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const p=j.find(x=>x.name==="mono");process.stdout.write((p&&p.pm2_env&&p.pm2_env.status)||"missing")}catch{process.stdout.write("missing")}})')"
if [[ "$MONO_STATUS" != "online" ]]; then
  pm2 restart mono >/dev/null 2>&1 || true
  send_tg "pm2 mono is ${MONO_STATUS} -> auto restart executed"
fi

MEM_PCT="$(free | awk '/Mem:/ {printf("%.0f", $3/$2*100)}')"
if [[ "${MEM_PCT:-0}" -ge 80 ]]; then
  send_tg "Memory usage ${MEM_PCT}% (>80%)"
fi

DISK_PCT="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if [[ "${DISK_PCT:-0}" -ge 90 ]]; then
  send_tg "Disk usage ${DISK_PCT}% (>90%)"
fi

ERR_LOG="$HOME/.pm2/logs/mono-error.log"
if [[ -f "$ERR_LOG" ]]; then
  SIG="$(tail -n 200 "$ERR_LOG" | grep -E -i 'error|fatal|crash' | tail -n 1 | sed 's/[[:space:]]\+/ /g' | cut -c1-220 || true)"
  LAST_SIG=""; [[ -f "$STATE_FILE" ]] && LAST_SIG="$(cat "$STATE_FILE")"
  if [[ -n "$SIG" && "$SIG" != "$LAST_SIG" ]]; then
    echo "$SIG" > "$STATE_FILE"
    send_tg "pm2 error log detected: ${SIG}"
  fi
fi

if ! curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
  pm2 restart mono >/dev/null 2>&1 || true
  send_tg "Health check failed (${HEALTH_URL}) -> pm2 restart executed"
fi

TOTAL_LOG_BYTES="$(du -cb $HOME/.pm2/logs/*.log 2>/dev/null | tail -n 1 | awk '{print $1}')"
TOTAL_LOG_BYTES=${TOTAL_LOG_BYTES:-0}
if [[ "$TOTAL_LOG_BYTES" -gt 104857600 ]]; then
  pm2 flush >/dev/null 2>&1 || true
  send_tg "PM2 logs exceeded 100MB -> pm2 flush executed"
fi

check_openai_status

echo "[$TS] OK status=${MONO_STATUS} mem=${MEM_PCT}% disk=${DISK_PCT}% logs=${TOTAL_LOG_BYTES}" >> "$LOG_DIR/monitor.log"