#!/bin/bash
# Nutrition Tracker — STANDALONE deploy (bundled Caddy in this repo)
#
# Use when you do NOT have a separate infrastructure/Caddy stack.
# Publishes http://localhost:3010 via nutrition-caddy container.
#
# Prefer ./deploy.sh with CADDY_STYLE=STANDALONE in .env (default if unset).
# Same flags as external-deploy.sh (--help via ./deploy.sh --help).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/deploy-lib.sh"

COMPOSE_FILES=(docker-compose.yml docker-compose.standalone.yml)

deploy_load_env "$SCRIPT_DIR"
deploy_parse_args "$@"

cd "$SCRIPT_DIR"

echo "========================================"
echo "Nutrition Tracker — STANDALONE deploy"
echo "========================================"
echo "Caddy: bundled (caddy/Caddyfile)"
echo "Compose: ${COMPOSE_FILES[*]}"

failure_report_step "Preflight (compose files, .env)"
deploy_preflight_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}"

if $RUN_TEST; then
  deploy_step "[0/6] Running npm test..."
  deploy_run_tests "$SCRIPT_DIR"
fi

if $RUN_GIT; then
  deploy_step "[1/6] Git commit and push..."
  deploy_run_git "$SCRIPT_DIR" "$COMMIT_MSG"
fi

if $DOWN; then
  deploy_step "[2/6] Stopping stack..."
  deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" down
fi

if $PULL; then
  deploy_step "[2/6] Pulling base images..."
  deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" pull
fi

deploy_step "[3/6] Building and starting (app + Caddy)..."
deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" up -d --build

deploy_step "[4/6] Service status..."
sleep 2
deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" ps

deploy_step "[5/6] Health check..."
deploy_health_check "$SCRIPT_DIR"

deploy_https_smoke "$SCRIPT_DIR"

deploy_print_footer "$SCRIPT_DIR" "${COMPOSE_FILES[@]}"
