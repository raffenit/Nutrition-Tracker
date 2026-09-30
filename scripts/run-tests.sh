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

if ! run_phase "[1/2] Server — unit + API tests (node --test)" npm --prefix "$ROOT/server" test; then
  server_ok=false
fi

if ! run_phase "[2/2] Web — TypeScript check (tsc --noEmit)" npm --prefix "$ROOT/web" run check; then
  web_ok=false
fi

log ""
log "========================================"
log "Summary"
log "  Server tests:  $([ "$server_ok" = true ] && echo PASS || echo FAIL)"
log "  Web typecheck: $([ "$web_ok" = true ] && echo PASS || echo FAIL)"
if $server_ok && $web_ok; then
  log "  Overall:       PASS"
  log "Finished: $(date -Iseconds)"
  log "========================================"
  exit 0
fi

log "  Overall:       FAIL"
log "Finished: $(date -Iseconds)"
log "========================================"
log ""
log "Both gates must pass before deploy. Fix failures above (server test counts alone are not enough)."
exit 1
