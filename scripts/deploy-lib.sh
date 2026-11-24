# Shared deploy steps for standalone-deploy.sh and external-deploy.sh
# shellcheck shell=bash

FAILURE_REPORT_NAME="${FAILURE_REPORT_NAME:-DEPLOY}"
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib-failure-report.sh"
failure_report_step "Loading .env and options"

# Print a numbered deploy step and remember it for the failure banner.
deploy_step() {
  failure_report_step "$*"
  echo ""
  echo "$*"
}

RUN_TEST=true
RUN_GIT=true
PULL=false
DOWN=false
RESTART_INFRA=false
COMMIT_MSG="${DEPLOY_COMMIT_MSG:-}"

# Print origin for humans: base URL (no port) + NUTRITION_PORT when needed.
deploy_normalize_tailscale_base() {
  local base="${1%/}"
  if [[ -z "$base" ]]; then
    return 1
  fi
  if [[ "$base" =~ ^https?:// ]]; then
    echo "$base"
    return 0
  fi
  if [[ "$base" =~ \.ts\.net$ ]]; then
    echo "https://${base}"
    return 0
  fi
  echo "http://${base}"
}

deploy_join_public_url() {
  local base="${1%/}"
  local port="${2:-3010}"
  base="$(deploy_normalize_tailscale_base "$base")"
  if [[ "$base" =~ ^https:// ]]; then
    # https://host:3010 in .env is a common mistake — phones use 443 via tailscale serve.
    if [[ "$base" =~ ^https://[^/]+:3010(/|$) ]]; then
      base="${base/:3010/}"
    fi
    echo "$base"
    return 0
  fi
  if [[ "$base" =~ ^http://[^/]+:[0-9]+ ]]; then
    echo "$base"
    return 0
  fi
  if [[ "$port" == "80" ]]; then
    echo "$base"
    return 0
  fi
  echo "${base}:${port}"
}

deploy_load_env() {
  local script_dir="$1"
  local legacy="$script_dir/local/deploy.env"

  if [[ -f "$legacy" ]]; then
    echo "Note: local/deploy.env is deprecated — merging into this run, then removing the file."
    echo "      Use .env only (see README Step 4). Add INFRA_COMPOSE_DIR or DEPLOY_COMMIT_MSG to .env if needed."
    set -a
    # shellcheck disable=SC1091
    source "$legacy"
    set +a
  fi

  if [[ -f "$script_dir/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$script_dir/.env"
    set +a
  fi

  if [[ -f "$legacy" ]]; then
    rm -f "$legacy"
    echo "Removed: local/deploy.env"
  fi

  COMMIT_MSG="${DEPLOY_COMMIT_MSG:-}"
}

deploy_parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --skip-test)
        RUN_TEST=false
        shift
        ;;
      --test)
        RUN_TEST=true
        shift
        ;;
      --skip-git)
        RUN_GIT=false
        shift
        ;;
      -m|--message)
        if [[ $# -lt 2 ]]; then
          echo "ERROR: -m/--message requires a commit message"
          exit 1
        fi
        COMMIT_MSG=$2
        shift 2
        ;;
      --pull)
        PULL=true
        shift
        ;;
      --down)
        DOWN=true
        shift
        ;;
      --infra)
        RESTART_INFRA=true
        shift
        ;;
      -h|--help)
        cat <<'EOF'
Usage:
  ./deploy.sh [options]

Options:
  -m, --message TEXT   Commit message when the tree is dirty
  --skip-test          Skip npm test (emergency only)
  --skip-git           Skip commit and push
  --pull               docker compose pull before build
  --down               compose down before up
  --infra              EXTERNAL only: restart ../infrastructure Caddy
  -h, --help           This help

Windows: run inside WSL2 (Ubuntu), not PowerShell — see docs/SETUP-WINDOWS-WSL.md
EOF
        exit 0
        ;;
      *)
        echo "Unknown option: $1 (try --help)"
        exit 1
        ;;
    esac
  done
}

deploy_compose() {
  local script_dir="$1"
  shift
  local -a cmd=(docker compose)
  while [[ $# -gt 0 && "$1" == *.yml ]]; do
    cmd+=(-f "$script_dir/$1")
    shift
  done
  if [[ $# -eq 0 ]]; then
    echo "ERROR: deploy_compose: missing compose subcommand (up, down, ps, …)"
    exit 1
  fi
  cmd+=("$@")
  deploy_export_build_info "$script_dir"
  FAILURE_REPORT_DETAIL="${cmd[*]}"
  "${cmd[@]}"
  FAILURE_REPORT_DETAIL=""
}

# Stamp the image with the commit being deployed (shown in /api/health and after deploy).
deploy_export_build_info() {
  local script_dir="$1"
  local commit
  commit="$(git -C "$script_dir" rev-parse --short HEAD 2>/dev/null)" || commit="unknown"
  if [[ "$commit" != "unknown" && -n "$(git -C "$script_dir" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
    commit="${commit}-dirty"
  fi
  export BUILD_COMMIT="$commit"
  # Commit time, not wall-clock: an unchanged redeploy keeps identical build args, so Compose reuses the image.
  export BUILD_COMMIT_TIME="$(git -C "$script_dir" log -1 --format=%cI 2>/dev/null || true)"
}

# Print the commit the running container reports; warn when it is not what we just built.
deploy_report_running_build() {
  local body="$1"
  local running
  running="$(node -e '
const health = JSON.parse(process.argv[1]);
const build = health.build ?? {};
process.stdout.write(`${build.commit ?? "unknown"}\t${build.committedAt ?? ""}`);
' "$body" 2>/dev/null)" || running=$'unknown\t'
  local commit="${running%%$'\t'*}"
  local committed_at="${running#*$'\t'}"
  echo "  Running build: ${commit}${committed_at:+ (committed ${committed_at})}"
  if [[ -n "${BUILD_COMMIT:-}" && "$commit" != "$BUILD_COMMIT" ]]; then
    echo "  WARNING: expected build ${BUILD_COMMIT} — the container may still be running an older image."
  fi
}

deploy_preflight_compose() {
  local script_dir="$1"
  shift
  for f in "$@"; do
    if [[ ! -f "$script_dir/$f" ]]; then
      echo "ERROR: Missing compose file: $script_dir/$f"
      exit 1
    fi
  done
}

deploy_run_tests() {
  local script_dir="$1"
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm is required (install Node, or pass --skip-test)."
    exit 1
  fi
  if [[ ! -f "$script_dir/package.json" ]]; then
    echo "ERROR: package.json not found in $script_dir"
    exit 1
  fi
  if ! npm test; then
    echo "Tests failed. Full log: $script_dir/local/test-last-run.log"
    exit 1
  fi
  echo "  Tests: OK (log: local/test-last-run.log)"
}

deploy_run_git() {
  local script_dir="$1"
  local commit_msg="$2"
  if ! command -v git >/dev/null 2>&1; then
    echo "ERROR: git is required (or pass --skip-git)."
    exit 1
  fi
  if ! git -C "$script_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "WARNING: Not a git repository — skipping commit/push."
    return 0
  fi
  if [[ -n "$(git -C "$script_dir" status --porcelain)" ]]; then
    if [[ -z "$commit_msg" ]]; then
      echo "ERROR: Uncommitted changes. Pass -m \"message\" or set DEPLOY_COMMIT_MSG in .env"
      git -C "$script_dir" status -sb
      exit 1
    fi
    git -C "$script_dir" add -A
    git -C "$script_dir" commit -m "$commit_msg"
    echo "  Committed: $commit_msg"
  fi
  local upstream
  upstream="$(git -C "$script_dir" rev-parse --abbrev-ref '@{u}' 2>/dev/null || true)"
  if [[ -z "$upstream" ]]; then
    echo "WARNING: No upstream branch — skipping push."
  elif [[ -n "$(git -C "$script_dir" rev-list "${upstream}..HEAD" 2>/dev/null || true)" ]]; then
    git -C "$script_dir" push
    echo "  Push: OK"
  else
    echo "  Nothing to push."
  fi
}

deploy_restart_infra() {
  local script_dir="$1"
  local infra_compose
  if [[ -n "${INFRA_COMPOSE_DIR:-}" ]]; then
    infra_compose="$INFRA_COMPOSE_DIR/docker-compose.yml"
  else
    infra_compose="$(cd "$script_dir/../infrastructure" 2>/dev/null && pwd)/docker-compose.yml"
  fi
  if [[ ! -f "$infra_compose" ]]; then
    echo "WARNING: --infra but infrastructure compose not found at: $infra_compose"
    return 0
  fi
  deploy_step "[infra] Restarting shared Caddy stack..."
  docker compose -f "$infra_compose" up -d
}

deploy_https_smoke() {
  local script_dir="$1"
  if [[ "${SKIP_HTTPS_SMOKE:-}" == "1" ]]; then
    echo ""
    echo "[6/6] Tailscale HTTPS smoke — SKIP (SKIP_HTTPS_SMOKE=1)"
    return 0
  fi
  echo ""
  echo "[6/6] Tailscale HTTPS smoke (when .env uses https:// or *.ts.net)..."
  if bash "$script_dir/scripts/test-https-smoke.sh"; then
    echo "  Tailscale HTTPS: OK"
    return 0
  fi
  echo ""
  echo "  WARNING: Tailscale HTTPS smoke failed — deploy finished; fix tailscale serve and phones may still need HTTP :3010."
  echo "  Set SKIP_HTTPS_SMOKE=1 in .env to hide this step."
  return 0
}

deploy_data_guard() {
  local script_dir="$1"
  if [[ "${SKIP_DATA_GUARD:-}" == "1" ]]; then
    echo "  Data guard: skipped (SKIP_DATA_GUARD=1)"
    return 0
  fi
  local marker="$script_dir/data/.household-established.json"
  if [[ ! -f "$marker" ]]; then
    echo "  Data guard: no household marker yet — OK"
    return 0
  fi
  local port="${NUTRITION_PORT:-3010}"
  local url="http://127.0.0.1:${port}/api/health"
  local body
  body="$(curl -sf "$url" 2>/dev/null)" || {
    echo "ERROR: Data guard could not reach $url"
    exit 1
  }
  if ! node -e '
const body = process.argv[1];
const health = JSON.parse(body);
const bad = health.dataUnexpectedlyEmpty === true
  || (health.householdEstablishedOnDisk === true && health.setupRequired === true);
process.exit(bad ? 1 : 0);
' "$body"; then
    echo ""
    echo "========================================================================"
    echo "DEPLOY STOPPED — HOUSEHOLD DATA LOOKS MISSING"
    echo "========================================================================"
    echo ""
    echo "The file data/.household-established.json says this install had a household,"
    echo "but /api/health reports zero users (setupRequired)."
    echo ""
    echo "DATA DIRECTORY: $script_dir/data"
    echo "ALSO READ:      $script_dir/data/last-startup-failure.txt (if the container exited)"
    echo ""
    echo "FIX (pick one):"
    echo "  A) Restore data/ from scripts/backup-data.sh or a zip of nutrition.sqlite*"
    echo "  B) Fresh start: remove data/nutrition.sqlite* and data/.household-established.json"
    echo "  C) Override:    SKIP_DATA_GUARD=1 in .env (only if intentional)"
    echo ""
    echo "Docs: docs/playbooks/data-backup-recovery.md"
    echo "Logs: docker compose logs nutrition --tail 80"
    echo ""
    exit 1
  fi
  echo "  Data guard: OK"
}

deploy_health_check() {
  local script_dir="$1"
  local port="${NUTRITION_PORT:-3010}"
  local url="http://127.0.0.1:${port}/api/health"
  echo "  URL: $url"
  local ready=false
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf "$url" >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 2
  done
  if $ready; then
    echo "  API health: OK"
    local body
    body="$(curl -sf "$url" 2>/dev/null || true)"
    echo "${body:0:200}"
    deploy_report_running_build "$body"
    deploy_data_guard "$script_dir"
  else
    echo "  API health: not ready — check logs (docker compose logs -f)"
    exit 1
  fi
}

deploy_print_footer() {
  local script_dir="$1"
  shift
  local -a files=("$@")
  local port="${NUTRITION_PORT:-3010}"
  local compose_hint="docker compose"
  for f in "${files[@]}"; do
    compose_hint+=" -f $f"
  done
  echo ""
  echo "========================================"
  echo "Deployment complete"
  echo "========================================"
  echo "Local:  http://localhost:${port}"
  local remote_base="${TAILSCALE_SERVER_URL:-${PUBLIC_URL:-}}"
  if [[ -n "$remote_base" ]]; then
    local remote
    remote="$(deploy_join_public_url "$remote_base" "$port")"
    echo "Tailscale (personal): ${remote}"
    echo "Tailscale (family):   ${remote%/}/family"
  else
    echo "Tailscale: set TAILSCALE_SERVER_URL in .env"
  fi
  echo ""
  echo "Logs:  $compose_hint logs -f"
  echo "Stop:  $compose_hint down"
}
