#!/bin/bash
# Quick gate: typecheck (server + web) + server tests excluding *.localFixtures.test.js
# See docs/testing-standards.md — use npm test for full complement (deploy).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/local/test-last-run-quick.log"

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
log "Nutrition Tracker — quick test run"
log "Started: $(date -Iseconds)"
log "Directory: $ROOT"
log "========================================"

server_typecheck_ok=true
server_tests_ok=true
web_typecheck_ok=true

if ! run_phase "[1/3] Server — TypeScript (production tsconfig.json, --noEmit)" npm --prefix "$ROOT/server" run check; then
  server_typecheck_ok=false
fi

if $server_typecheck_ok; then
  if ! run_phase "[1/3] Server — TypeScript (test tsconfig.test.json, --noEmit)" npm --prefix "$ROOT/server" run check:test; then
    server_typecheck_ok=false
  fi
fi

if $server_typecheck_ok; then
  if ! run_phase "[2/3] Server — quick tests (excludes *localFixtures*)" npm --prefix "$ROOT/server" run test:run:quick; then
    server_tests_ok=false
  fi
fi

if ! run_phase "[3/3] Web — TypeScript (tsc --noEmit)" npm --prefix "$ROOT/web" run check; then
  web_typecheck_ok=false
fi

log ""
log "========================================"
log "Summary (quick)"
log "  Server typecheck: $([ "$server_typecheck_ok" = true ] && echo PASS || echo FAIL)"
log "  Server tests:     $([ "$server_tests_ok" = true ] && echo PASS || echo FAIL)"
log "  Web typecheck:    $([ "$web_typecheck_ok" = true ] && echo PASS || echo FAIL)"
if $server_typecheck_ok && $server_tests_ok && $web_typecheck_ok; then
  log "  Overall:          PASS"
  log "Finished: $(date -Iseconds)"
  log "========================================"
  log ""
  log "Full complement: npm test (includes localFixtures + deploy parity). See docs/testing-standards.md."
  exit 0
fi

log "  Overall:          FAIL"
log "Finished: $(date -Iseconds)"
log "========================================"
exit 1