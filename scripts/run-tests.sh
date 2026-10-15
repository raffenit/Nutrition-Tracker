#!/bin/bash
# Run server tests + web typecheck; mirror all output to local/test-last-run.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/local/test-last-run.log"

mkdir -p "$ROOT/local"
: >"$LOG"

log() {
  echo "$@" | tee -a "$LOG"
}

run_phase() {
  local label=$1
  shift
  log ""
  log "----------------------------------------"
  log "$label"
  log "----------------------------------------"
  set +e
  "$@" 2>&1 | tee -a "$LOG"
  local status=${PIPESTATUS[0]}
  set -e
  return "$status"
}

log "========================================"
log "Nutrition Tracker test run"
log "Started: $(date -Iseconds)"
log "Directory: $ROOT"
log "========================================"

server_ok=true
web_ok=true
https_ok=true
https_label=SKIP

if ! run_phase "[1/3] Server — unit + API tests (node --test)" npm --prefix "$ROOT/server" test; then
  server_ok=false
fi

if ! run_phase "[2/3] Web — TypeScript check (tsc --noEmit)" npm --prefix "$ROOT/web" run check; then
  web_ok=false
fi

HTTPS_SMOKE_OUT="$ROOT/local/https-smoke-last.txt"
if bash "$ROOT/scripts/test-https-smoke.sh" >"$HTTPS_SMOKE_OUT" 2>&1; then
  https_smoke_status=0
else
  https_smoke_status=$?
fi
log ""
log "----------------------------------------"
log "[3/3] Tailscale HTTPS smoke (when .env uses https://)"
log "----------------------------------------"
cat "$HTTPS_SMOKE_OUT" | tee -a "$LOG"
if grep -q '^SKIP:' "$HTTPS_SMOKE_OUT"; then
  https_label=SKIP
elif [[ "$https_smoke_status" -eq 0 ]]; then
  https_label=PASS
else
  https_label=FAIL
  https_ok=false
fi

log ""
log "========================================"
log "Summary"
log "  Server tests:  $([ "$server_ok" = true ] && echo PASS || echo FAIL)"
log "  Web typecheck: $([ "$web_ok" = true ] && echo PASS || echo FAIL)"
log "  HTTPS smoke:   $https_label"
if $server_ok && $web_ok && $https_ok; then
  log "  Overall:       PASS"
  log "Finished: $(date -Iseconds)"
  log "========================================"
  exit 0
fi

log "  Overall:       FAIL"
log "Finished: $(date -Iseconds)"
log "========================================"
log ""
log "Server + web must pass; HTTPS smoke runs only when TAILSCALE_SERVER_URL is https:// (or set SKIP_HTTPS_SMOKE=1)."
exit 1
