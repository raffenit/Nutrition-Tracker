#!/bin/bash
# Nutrition Tracker — EXTERNAL deploy (shared homelab Caddy + media-network)
#
# Use when infrastructure/ already runs Caddy on :3010 and defines media-network.
# This repo only starts nutrition-tracker; no bundled Caddy.
#
# Prefer ./deploy.sh with CADDY_STYLE=EXTERNAL in .env.
# Direct use (unusual):
#   ./external-deploy.sh --infra   # also restart ../infrastructure Caddy

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/deploy-lib.sh"

COMPOSE_FILES=(docker-compose.yml)

deploy_load_env "$SCRIPT_DIR"
deploy_parse_args "$@"

cd "$SCRIPT_DIR"

echo "========================================"
echo "Nutrition Tracker — EXTERNAL deploy"
echo "========================================"
echo "Caddy: shared infrastructure (not this repo)"
echo "Compose: docker-compose.yml"

deploy_preflight_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}"

if ! docker network inspect media-network >/dev/null 2>&1; then
  echo "ERROR: Docker network 'media-network' not found."
  echo "Start your infrastructure stack first, or set CADDY_STYLE=STANDALONE in .env and run ./deploy.sh."
  echo "Set INFRA_COMPOSE_DIR in .env if infrastructure is not ../infrastructure"
  exit 1
fi

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
  echo "[2/6] Stopping nutrition-tracker..."
  deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" down
fi

if $PULL; then
  echo ""
  echo "[2/6] Pulling base images..."
  deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" pull
fi

echo ""
echo "[3/6] Building and starting nutrition-tracker..."
deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" up -d --build

if $RESTART_INFRA; then
  deploy_restart_infra "$SCRIPT_DIR"
fi

echo ""
echo "[4/6] Service status..."
sleep 2
deploy_compose "$SCRIPT_DIR" "${COMPOSE_FILES[@]}" ps

echo ""
echo "[5/6] Health check..."
deploy_health_check

deploy_https_smoke "$SCRIPT_DIR"

deploy_print_footer "$SCRIPT_DIR" "${COMPOSE_FILES[@]}"
