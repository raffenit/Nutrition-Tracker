#!/bin/bash
# Nutrition Tracker — build and deploy (Docker Compose)
#
# Run from the repo root on your server:
#   ./deploy.sh
#
# Usage:
#   ./deploy.sh                 # docker compose up -d --build + health check
#   ./deploy.sh --test          # npm test, then deploy
#   ./deploy.sh --pull          # docker compose pull (base images) before build
#   ./deploy.sh --down          # compose down, then deploy
#   ./deploy.sh --infra         # restart sibling infrastructure stack (Caddy)
#   ./deploy.sh --help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

if [[ -f "$SCRIPT_DIR/local/deploy.env" ]]; then
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/local/deploy.env"
fi

PORT="${NUTRITION_PORT:-3010}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

if [[ -n "${INFRA_COMPOSE_DIR:-}" ]]; then
    INFRA_COMPOSE="$INFRA_COMPOSE_DIR/docker-compose.yml"
else
    INFRA_COMPOSE="$(cd "$SCRIPT_DIR/../infrastructure" 2>/dev/null && pwd)/docker-compose.yml"
fi

RUN_TEST=false
PULL=false
DOWN=false
RESTART_INFRA=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --test)
            RUN_TEST=true
            shift
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
            sed -n '2,14p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown option: $1 (try --help)"
            exit 1
            ;;
    esac
done

cd "$SCRIPT_DIR"

echo "========================================"
echo "Nutrition Tracker deployment"
echo "========================================"
echo "Directory:    $SCRIPT_DIR"
echo "Compose file: $COMPOSE_FILE"

if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "ERROR: Compose file not found: $COMPOSE_FILE"
    exit 1
fi

if ! docker network inspect media-network >/dev/null 2>&1; then
    echo "ERROR: Docker network 'media-network' not found."
    echo "Start your infrastructure stack first (Caddy + media-network)."
    echo "Set INFRA_COMPOSE_DIR in local/deploy.env if it is not ../infrastructure"
    exit 1
fi

if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    if [[ -f "$SCRIPT_DIR/.env.example" ]]; then
        echo ""
        echo "NOTE: No .env file — using compose defaults. Copy .env.example if you need USDA_API_KEY or PUBLIC_URL."
    fi
fi

if $RUN_TEST; then
    echo ""
    echo "[test] Running npm test..."
    if ! command -v npm >/dev/null 2>&1; then
        echo "ERROR: --test requires npm on the host (or deploy without --test; the image still builds tests inside Docker)."
        exit 1
    fi
    npm test
fi

if $DOWN; then
    echo ""
    echo "[1/4] Stopping existing stack..."
    docker compose -f "$COMPOSE_FILE" down
fi

if $PULL; then
    echo ""
    echo "[1/4] Pulling base images..."
    docker compose -f "$COMPOSE_FILE" pull
fi

echo ""
echo "[2/4] Building and starting nutrition-tracker..."
docker compose -f "$COMPOSE_FILE" up -d --build

if $RESTART_INFRA; then
    if [[ ! -f "$INFRA_COMPOSE" ]]; then
        echo "WARNING: --infra requested but infrastructure compose not found at:"
        echo "  $INFRA_COMPOSE"
        echo "Set INFRA_COMPOSE_DIR in local/deploy.env or place infrastructure next to this repo."
        echo "Skipping infrastructure restart."
    else
        echo ""
        echo "[infra] Restarting Caddy / infrastructure..."
        docker compose -f "$INFRA_COMPOSE" up -d
    fi
fi

echo ""
echo "[3/4] Service status..."
sleep 2
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "[4/4] Health check ($HEALTH_URL)..."
ready=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 2
done

if $ready; then
    echo "  API health: OK"
    curl -sf "$HEALTH_URL" | head -c 200
    echo ""
else
    echo "  API health: not ready yet — check logs:"
    echo "    docker compose -f \"$COMPOSE_FILE\" logs -f --tail=80"
    exit 1
fi

echo ""
echo "========================================"
echo "Deployment complete"
echo "========================================"
echo "Local:  http://localhost:${PORT}"
if [[ -n "${REMOTE_BASE_URL:-}" ]]; then
    echo "Remote: ${REMOTE_BASE_URL}"
    echo "Family: ${REMOTE_BASE_URL%/}/family"
else
    echo "Remote: set REMOTE_BASE_URL in local/deploy.env (see local.example/) for your Tailscale or public URL"
fi
echo ""
echo "Logs:  docker compose -f \"$COMPOSE_FILE\" logs -f"
echo "Stop:  docker compose -f \"$COMPOSE_FILE\" down"
