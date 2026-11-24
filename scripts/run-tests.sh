#!/bin/bash
# Typecheck (server + web) and server tests; mirror all output to local/test-last-run.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILURE_REPORT_NAME="TEST RUN"
# shellcheck disable=SC1091
source "$ROOT/scripts/lib-failure-report.sh"
LOG="$ROOT/local/test-last-run.log"

mkdir -p "$ROOT/local"
: >"$LOG"

log() {
  echo "$@" | tee -a "$LOG"
}

run_phase() {
  local label=$1
  shift
  failure_report_step "$label"
  log ""
  log "----------------------------------------"
  log "$label"
  log "----------------------------------------"
  set +e
  "$@" 2>&1 | tee -a "$LOG"
  local status=${PIPESTATUS[0]}
  set -e
  if [[ "$status" -ne 0 ]]; then
    failed_phases+=("$label (exit $status: $*)")
  fi
  return "$status"
}

failed_phases=()

log "========================================"
log "Nutrition Tracker test run"
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
  if ! run_phase "[2/3] Server — tests (dist-test/**/*.test.js)" npm --prefix "$ROOT/server" run test:run; then
    server_tests_ok=false
  fi
fi

if ! run_phase "[3/3] Web — TypeScript (tsc --noEmit)" npm --prefix "$ROOT/web" run check; then
  web_typecheck_ok=false
fi

failure_report_step "Summary (all phases finished; see PASS/FAIL lines)"
log ""
log "========================================"
log "Summary"
log "  Server typecheck: $([ "$server_typecheck_ok" = true ] && echo PASS || echo FAIL)"
log "  Server tests:     $([ "$server_tests_ok" = true ] && echo PASS || echo FAIL)"
log "  Web typecheck:    $([ "$web_typecheck_ok" = true ] && echo PASS || echo FAIL)"
# TAP prints "# skipped N", the spec reporter (default on newer Node / TTY) prints "ℹ skipped N".
# `|| true`: no match must not abort the summary under `set -euo pipefail`.
skipped_tests="$( (grep -oE '^(#|ℹ) skipped [0-9]+' "$LOG" || true) | tail -1 | awk '{print $3}')"
if [ -n "${skipped_tests:-}" ] && [ "$skipped_tests" -gt 0 ] 2>/dev/null; then
  log "  Skipped tests:    $skipped_tests (photo-fixture OCR tests self-skip when local/test-images/ is absent — host-specific, gitignored)"
fi
if $server_typecheck_ok && $server_tests_ok && $web_typecheck_ok; then
  log "  Overall:          PASS"
  log "Finished: $(date -Iseconds)"
  log "========================================"
  log ""
  log "HTTPS smoke runs after deploy (./deploy.sh), not during npm test."
  exit 0
fi

failed_summary="$(printf '%s; ' "${failed_phases[@]}")"
failure_report_step "Failed: ${failed_summary%; }"
log "  Overall:          FAIL"
log "Finished: $(date -Iseconds)"
log "========================================"
log ""
log "All three gates must pass before deploy. Typecheck failures are listed above — fix TS errors before relying on test counts."
log "See docs/testing-standards.md"
exit 1
