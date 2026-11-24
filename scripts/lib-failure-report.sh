# shellcheck shell=bash
# Never fail silently: source this from any deploy/test script that runs with `set -e`.
#
#   FAILURE_REPORT_NAME="Deploy"        # banner title (default: script name)
#   source "$ROOT/scripts/lib-failure-report.sh"
#   failure_report_step "[3/6] Building…" # optional: name the current step for the banner
#
# Any non-zero exit — a failed command under `set -e`, an explicit `exit 1`, or a
# crash inside a summary — prints a banner to stderr with the step, exit code,
# and the last failing command + file:line. Successful runs print nothing extra.

FAILURE_REPORT_NAME="${FAILURE_REPORT_NAME:-$(basename "$0")}"
FAILURE_REPORT_STEP="${FAILURE_REPORT_STEP:-}"
# Optional expanded command line for the current step (BASH_COMMAND shows "${cmd[@]}" unexpanded).
FAILURE_REPORT_DETAIL=""
_failure_report_cmd=""
_failure_report_where=""

# errtrace: the ERR trap also fires inside functions and subshells.
set -E

_failure_report_record() {
  _failure_report_cmd="$1"
  _failure_report_where="${2:-?}:${3:-?}"
}

_failure_report_on_exit() {
  local code=$1
  [[ "$code" -eq 0 ]] && return 0
  local red="" bold="" reset=""
  if [[ -t 2 ]]; then
    red=$'\033[31m'
    bold=$'\033[1m'
    reset=$'\033[0m'
  fi
  {
    echo ""
    echo "${red}${bold}========================================================================${reset}"
    echo "${red}${bold}${FAILURE_REPORT_NAME} FAILED (exit ${code})${reset}"
    echo "${red}${bold}========================================================================${reset}"
    if [[ -n "$FAILURE_REPORT_STEP" ]]; then
      echo "  Step:     ${FAILURE_REPORT_STEP}"
    fi
    if [[ -n "$FAILURE_REPORT_DETAIL" ]]; then
      echo "  Running:  ${FAILURE_REPORT_DETAIL}"
    fi
    if [[ -n "$_failure_report_cmd" ]]; then
      echo "  Command:  ${_failure_report_cmd}"
      echo "  Where:    ${_failure_report_where}"
    fi
    echo "  Scroll up for the error output from that step."
    echo ""
  } >&2
}

failure_report_step() {
  FAILURE_REPORT_STEP="$*"
  FAILURE_REPORT_DETAIL=""
}

trap '_failure_report_record "$BASH_COMMAND" "${BASH_SOURCE[0]:-$0}" "$LINENO"' ERR
trap '_failure_report_on_exit $?' EXIT
