#!/bin/bash
# Optional smoke test: GET /api/health over HTTPS when TAILSCALE_SERVER_URL (or PUBLIC_URL) is https://
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${SKIP_HTTPS_SMOKE:-}" == "1" ]]; then
  echo "SKIP: SKIP_HTTPS_SMOKE=1"
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
  echo "SKIP: no TAILSCALE_SERVER_URL or PUBLIC_URL in .env"
  exit 0
fi

if [[ ! "$base" =~ ^https:// ]]; then
  if [[ "$base" =~ \.ts\.net$ ]]; then
    base="https://${base}"
  else
    echo "SKIP: Tailscale server URL is not HTTPS ($base)"
    exit 0
  fi
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "FAIL: curl is required for HTTPS smoke test"
  exit 1
fi

health_url="${base}/api/health"
echo "GET $health_url"

local_port="${NUTRITION_PORT:-3010}"
local_url="http://127.0.0.1:${local_port}/api/health"

body=""
if ! body="$(curl -sfS --max-time 25 "$health_url")"; then
  echo "FAIL: HTTPS health request failed ($health_url)"
  if local_body="$(curl -sfS --max-time 5 "$local_url" 2>/dev/null)" && [[ "$local_body" == *'"ok":true'* ]]; then
    echo "      Local app is OK ($local_url) — Tailscale HTTPS is not proxying to port ${local_port}."
    echo "      Fix: sudo tailscale serve --bg http://127.0.0.1:${local_port}"
    echo "      Check: tailscale serve status"
  else
    echo "      Local health also failed — ensure the stack is up (./deploy.sh)."
  fi
  exit 1
fi

if [[ "$body" != *'"ok":true'* && "$body" != *'"ok": true'* ]]; then
  echo "FAIL: unexpected health response: ${body:0:200}"
  exit 1
fi

echo "OK: ${body:0:120}"
