#!/bin/bash
# Pre-flight for WSL deploy — invoked from deploy.sh when running under WSL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

warn() { echo "WARNING: $*" >&2; }
fail() { echo "ERROR: $*" >&2; exit 1; }

# --- Line endings (TODO 2: CRLF from Windows checkout/editors) ---
fixed=0
for f in deploy.sh external-deploy.sh standalone-deploy.sh scripts/*.sh; do
  [[ -f "$f" ]] || continue
  if grep -q $'\r' "$f" 2>/dev/null; then
    sed -i 's/\r$//' "$f"
    echo "Fixed CRLF → LF: $f"
    fixed=$((fixed + 1))
  fi
done
chmod +x deploy.sh external-deploy.sh standalone-deploy.sh scripts/*.sh 2>/dev/null || true
if (( fixed > 0 )); then
  echo "Tip: git pull .gitattributes and set 'git config core.autocrlf false' in WSL — see docs/WINDOWS-TROUBLESHOOTING.md"
fi

# --- .env syntax (no spaces around =) ---
if [[ -f .env ]]; then
  if bad="$(grep -nE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]+=' .env | grep -v '^[[:space:]]*#' || true)"; then
    warn "`.env` lines with spaces before '=' break bash 'source' — use KEY=value"
    echo "$bad" | head -5 >&2
  fi
  if grep -q $'\r' .env 2>/dev/null; then
    warn "`.env` contains CRLF; save as LF in your editor or: sed -i 's/\\r$//' .env"
  fi
fi

# --- Docker daemon from WSL (TODO 3) ---
if ! command -v docker >/dev/null 2>&1; then
  fail "docker not in PATH inside WSL. Install Docker Desktop and enable WSL integration — docs/WINDOWS-TROUBLESHOOTING.md"
fi
if ! docker info >/dev/null 2>&1; then
  fail "Cannot reach Docker from WSL. Start Docker Desktop, enable WSL integration for this distro, and add your user to the docker group (see docs/WINDOWS-TROUBLESHOOTING.md)."
fi
if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose not available in WSL."
fi

# --- Prefer native WSL home over /mnt/c ---
case "$ROOT" in
  /mnt/*)
    warn "Repo is under /mnt/ (Windows drive). Prefer ~/Nutrition-Tracker in WSL for Node/Docker — docs/WINDOWS-TROUBLESHOOTING.md"
    ;;
esac

exit 0
