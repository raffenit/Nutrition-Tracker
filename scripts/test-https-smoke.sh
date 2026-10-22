#!/bin/bash
# Optional smoke test: GET /api/health over HTTPS when TAILSCALE_SERVER_URL (or PUBLIC_URL) is https://
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SMOKE_LOG="$ROOT/local/https-smoke-last.txt"

smoke_log() {
  mkdir -p "$ROOT/local"
  echo "$@" | tee -a "$SMOKE_LOG"
}

: >"$SMOKE_LOG"
smoke_log "Started: $(date -Iseconds)"

if [[ "${SKIP_HTTPS_SMOKE:-}" == "1" ]]; then
  smoke_log "SKIP: SKIP_HTTPS_SMOKE=1"
  exit 0
fi

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

base="${TAILSCALE_SERVER_URL:-${PUBLIC_URL:-}}"
base="${base%/}"

if [[ -z "$base" ]]; then
  smoke_log "SKIP: no TAILSCALE_SERVER_URL or PUBLIC_URL in .env"
  exit 0
fi

if [[ ! "$base" =~ ^https:// ]]; then
  if [[ "$base" =~ \.ts\.net$ ]]; then
    base="https://${base}"
  else
    smoke_log "SKIP: Tailscale server URL is not HTTPS ($base)"
    exit 0
  fi
fi

if ! command -v curl >/dev/null 2>&1; then
  smoke_log "FAIL: curl is required for HTTPS smoke test"
  exit 1
fi

health_url="${base}/api/health"
smoke_log "GET $health_url"

local_port="${NUTRITION_PORT:-3010}"
local_url="http://127.0.0.1:${local_port}/api/health"

body=""
if ! body="$(curl -sfS --max-time 25 "$health_url")"; then
  smoke_log "FAIL: HTTPS health request failed ($health_url)"
  if local_body="$(curl -sfS --max-time 5 "$local_url" 2>/dev/null)" && [[ "$local_body" == *'"ok":true'* ]]; then
    smoke_log "      Local app is OK ($local_url) — Tailscale HTTPS is not proxying to port ${local_port}."
    smoke_log "      Fix: sudo tailscale serve --bg http://127.0.0.1:${local_port}"
    smoke_log "      Check: tailscale serve status"
  else
    smoke_log "      Local health also failed — ensure the stack is up (./deploy.sh)."
  fi
  smoke_log "Finished: $(date -Iseconds) (FAIL)"
  exit 1
fi

if [[ "$body" != *'"ok":true'* && "$body" != *'"ok": true'* ]]; then
  smoke_log "FAIL: unexpected health response: ${body:0:200}"
  smoke_log "Finished: $(date -Iseconds) (FAIL)"
  exit 1
fi

smoke_log "OK: ${body:0:120}"
smoke_log "Finished: $(date -Iseconds) (OK)"
