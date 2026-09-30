#!/bin/bash
# Nutrition Tracker — build and deploy (Docker Compose)
#
# Run from the repo root on your server:
#   ./deploy.sh
#
# Usage:
#   ./deploy.sh                 # npm test, git commit/push (if needed), then docker deploy
#   ./deploy.sh -m "message"    # commit message when you have uncommitted changes
#   ./deploy.sh --skip-test     # deploy without running tests (emergency only)
#   ./deploy.sh --skip-git      # deploy without commit or push
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

RUN_TEST=true
RUN_GIT=true
PULL=false
DOWN=false
RESTART_INFRA=false
COMMIT_MSG="${DEPLOY_COMMIT_MSG:-}"

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
            sed -n '2,16p' "$0" | sed 's/^# \?//'
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
    echo "[0/6] Running npm test (server tests + web typecheck)..."
    if ! command -v npm >/dev/null 2>&1; then
        echo "ERROR: npm is required for deploy (install Node on the host, or use ./deploy.sh --skip-test)."
        exit 1
    fi
    if [[ ! -f "$SCRIPT_DIR/package.json" ]]; then
        echo "ERROR: package.json not found in $SCRIPT_DIR"
        exit 1
    fi
    if ! npm test; then
        echo ""
        echo "Tests failed. Full log: $SCRIPT_DIR/local/test-last-run.log"
        exit 1
    fi
    echo "  Tests: OK (log: local/test-last-run.log)"
fi

if $RUN_GIT; then
    echo ""
    echo "[1/6] Git commit and push..."
    if ! command -v git >/dev/null 2>&1; then
        echo "ERROR: git is required for deploy (or use ./deploy.sh --skip-git)."
        exit 1
    fi
    if ! git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo "WARNING: Not a git repository — skipping commit/push."
    else
        dirty=false
        if [[ -n "$(git -C "$SCRIPT_DIR" status --porcelain)" ]]; then
            dirty=true
        fi

        if $dirty; then
            if [[ -z "$COMMIT_MSG" ]]; then
                echo "ERROR: Uncommitted changes. Pass -m \"your message\" or set DEPLOY_COMMIT_MSG in local/deploy.env"
                git -C "$SCRIPT_DIR" status -sb
                exit 1
            fi
            git -C "$SCRIPT_DIR" add -A
            git -C "$SCRIPT_DIR" commit -m "$COMMIT_MSG"
            echo "  Committed: $COMMIT_MSG"
        fi

        upstream="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref '@{u}' 2>/dev/null || true)"
        if [[ -z "$upstream" ]]; then
            echo "WARNING: No upstream branch — skipping push (set upstream with git push -u origin main)."
        elif [[ -n "$(git -C "$SCRIPT_DIR" rev-list "${upstream}..HEAD" 2>/dev/null || true)" ]]; then
            git -C "$SCRIPT_DIR" push
            echo "  Push: OK"
        else
            echo "  Nothing to push (already up to date with remote)."
        fi
    fi
fi

if $DOWN; then
    echo ""
    echo "[2/6] Stopping existing stack..."
    docker compose -f "$COMPOSE_FILE" down
fi

if $PULL; then
    echo ""
    echo "[2/6] Pulling base images..."
    docker compose -f "$COMPOSE_FILE" pull
fi

echo ""
echo "[3/6] Building and starting nutrition-tracker..."
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
echo "[4/6] Service status..."
sleep 2
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "[5/6] Health check ($HEALTH_URL)..."
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
