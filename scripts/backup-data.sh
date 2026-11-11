#!/usr/bin/env bash
# Copy household SQLite (with WAL checkpoint when sqlite3 is available).
# Safe to run while the app is running; for restores, stop the container first.
#
# Usage:
#   ./scripts/backup-data.sh              # uses ./data next to repo root
#   ./scripts/backup-data.sh /path/to/data
#   BACKUP_DIR=~/nutrition-backups ./scripts/backup-data.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${1:-$ROOT/data}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
KEEP="${BACKUP_KEEP_COUNT:-14}"

DB="$DATA_DIR/nutrition.sqlite"

if [[ ! -f "$DB" ]]; then
  echo "ERROR: No database at $DB"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/nutrition-$STAMP.sqlite"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);"
  sqlite3 "$DB" ".backup '$DEST'"
else
  echo "WARNING: sqlite3 not found — copying main DB file and WAL siblings (less safe than .backup)."
  cp -a "$DB" "$DEST"
  for suffix in -wal -shm; do
    if [[ -f "$DB$suffix" ]]; then
      cp -a "$DB$suffix" "$DEST$suffix"
    fi
  done
fi

echo "Backup written: $DEST"

if command -v ls >/dev/null 2>&1; then
  mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/nutrition-*.sqlite 2>/dev/null | tail -n +"$((KEEP + 1))" || true)
  for f in "${OLD[@]:-}"; do
    rm -f "$f" "$f-wal" "$f-shm"
  done
fi
