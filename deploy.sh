#!/bin/bash
# Dispatches to standalone-deploy.sh or external-deploy.sh using CADDY_STYLE in .env
#
# CADDY_STYLE=STANDALONE  → bundled Caddy (default; new installs)
# CADDY_STYLE=EXTERNAL    → shared infrastructure Caddy + media-network
#
# Prefer this script. standalone-deploy.sh / external-deploy.sh are helpers; use them directly only in edge cases (see README deploy reference).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Windows/WSL host checks (CRLF, Docker, .env hints) — skip on Linux server or SKIP_WSL_PREFLIGHT=1
if [[ "${SKIP_WSL_PREFLIGHT:-}" != "1" ]]; then
  if [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
    bash "$SCRIPT_DIR/scripts/wsl-preflight.sh"
  fi
fi

if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

style="$(printf '%s' "${CADDY_STYLE:-STANDALONE}" | tr '[:lower:]' '[:upper:]')"
case "$style" in
  EXTERNAL)
    exec "$SCRIPT_DIR/external-deploy.sh" "$@"
    ;;
  STANDALONE)
    exec "$SCRIPT_DIR/standalone-deploy.sh" "$@"
    ;;
  *)
    echo "ERROR: Unknown CADDY_STYLE=$style (use STANDALONE or EXTERNAL in .env)"
    exit 1
    ;;
esac
