#!/bin/bash
# Nutrition Tracker — STANDALONE deploy (bundled Caddy in this repo)
#
# Use when you do NOT have a separate infrastructure/Caddy stack.
# Publishes http://localhost:3010 via nutrition-caddy container.
#
# Run from repo root (Linux, macOS, or Windows WSL2):
#   ./standalone-deploy.sh
#   ./standalone-deploy.sh --skip-test --skip-git
#
# Same flags as external-deploy.sh (--help for list).

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

deploy_preflight_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}"

if $RUN_TEST; then
  echo ""
  echo "[0/6] Running npm test..."
  deploy_run_tests "$SCRIPT_DIR"
fi

if $RUN_GIT; then
  echo ""
  echo "[1/6] Git commit and push..."
  deploy_run_git "$SCRIPT_DIR" "$COMMIT_MSG"
fi

if $DOWN; then
  echo ""
  echo "[2/6] Stopping stack..."
  deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" down
fi

if $PULL; then
  echo ""
  echo "[2/6] Pulling base images..."
  deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" pull
fi

echo ""
echo "[3/6] Building and starting (app + Caddy)..."
deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" up -d --build

echo ""
echo "[4/6] Service status..."
sleep 2
deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" ps

echo ""
echo "[5/6] Health check..."
deploy_health_check

deploy_print_footer "$SCRIPT_DIR" "${COMPOSE_FILES[@]}"
