#!/usr/bin/env bash
# Manage one isolated DSH web instance for Task Manager development and E2E.
#
# The instance never touches the production profile: it uses its own DSH_HOME
# (default /tmp/dsh-tm-e2e), its own profile directory, and its own port.
#
#   scripts/e2e-instance.sh start [port]
#   scripts/e2e-instance.sh stop
#   scripts/e2e-instance.sh restart [port]
#   scripts/e2e-instance.sh url
#   scripts/e2e-instance.sh status
#
# Environment:
#   DSH_E2E_HOME  isolated DSH_HOME (default /tmp/dsh-tm-e2e)
#   DSH_E2E_PORT  default port (default 3090)
#   DSH_E2E_HEAP  V8 old-space cap in MB (default 768, keeps the host safe)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${DSH_E2E_HOME:-/tmp/dsh-tm-e2e}"
PORT="${2:-${DSH_E2E_PORT:-3090}}"
HEAP="${DSH_E2E_HEAP:-768}"
PID_FILE="$HOME_DIR/web.pid"
URL_FILE="$HOME_DIR/url.txt"
LOG_FILE="$HOME_DIR/web.log"

ensure_profile() {
  mkdir -p "$HOME_DIR"
  if [ ! -f "$HOME_DIR/profiles/web/package.json" ]; then
    DSH_HOME="$HOME_DIR" dsh --profile web --dump-config >/dev/null
  fi
  # Link the workspace package into the isolated profile (idempotent).
  ( cd "$ROOT" && DSH_HOME="$HOME_DIR" dsh plugin --profile web add "$ROOT" >/dev/null 2>&1 ) || true
}

stop_instance() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 40); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE" "$URL_FILE"
  fi
}

start_instance() {
  ensure_profile
  stop_instance
  : > "$LOG_FILE"
  ( cd "$HOME_DIR" && DSH_HOME="$HOME_DIR" NODE_OPTIONS="--max-old-space-size=$HEAP" \
      nohup dsh --profile web --no-open --host 127.0.0.1 --port "$PORT" >"$LOG_FILE" 2>&1 & echo $! >"$PID_FILE" )
  for _ in $(seq 1 120); do
    if grep -q "token=" "$LOG_FILE" 2>/dev/null; then
      grep -o 'http://[^ ]*token=[A-Za-z0-9_-]*' "$LOG_FILE" | tail -1 > "$URL_FILE"
      echo "instance ready: $(cat "$URL_FILE")"
      return 0
    fi
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "instance exited; log:" >&2
      tail -40 "$LOG_FILE" >&2
      return 1
    fi
    sleep 0.5
  done
  echo "timed out waiting for the instance URL; log:" >&2
  tail -40 "$LOG_FILE" >&2
  return 1
}

case "${1:-status}" in
  start) start_instance ;;
  stop) stop_instance; echo "stopped" ;;
  restart) stop_instance; start_instance ;;
  url)
    if [ -f "$URL_FILE" ]; then cat "$URL_FILE"; else echo "not running" >&2; exit 1; fi
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "running pid=$(cat "$PID_FILE") port=$PORT url=$(cat "$URL_FILE" 2>/dev/null || echo '?')"
    else
      echo "stopped"
    fi
    ;;
  *)
    echo "usage: $0 {start|stop|restart|url|status} [port]" >&2
    exit 2
    ;;
esac
