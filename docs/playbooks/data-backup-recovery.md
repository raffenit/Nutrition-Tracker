# Playbook — household data backup and recovery

Household data lives only on the **host** in `data/` (`nutrition.sqlite`, uploads, OCR models). Git and container rebuilds must **not** replace that folder.

## Where logs go (debugging crashes)

| Location | When to look |
| --- | --- |
| **`docker compose logs nutrition`** (or `docker logs nutrition-tracker`) | Primary — all `console.log` / `console.error` from the app |
| **`data/last-startup-failure.txt`** | Written when the app **refuses to start** (missing household, corrupt DB, boot error). Same text is printed to Docker logs. **Open this on the host** if the container is in a restart loop. |
| **`data/nutrition-events.log`** | Append-only: startup listening, graceful shutdown, refusals, WAL warnings |
| **`local/test-last-run.log`** | `npm test` only (repo root), not production |

There is no separate rotating log file inside the container image; persistence problems are designed to be obvious in **both** Docker logs and `last-startup-failure.txt`.

## Graceful stop vs Docker crash

| Event | What happens | Our mitigation |
| --- | --- | --- |
| `docker stop`, `compose down`, deploy recreates container | Docker sends **SIGTERM**, then **SIGKILL** after `stop_grace_period` (30s on the app service) | Node handler checkpoints WAL on **SIGTERM** before exit |
| **Docker crash**, host power loss, `kill -9`, OOM kill | **No SIGTERM** — process dies mid-write | SQLite replays `-wal` on next **open**; we run `wal_checkpoint(RESTART)` on **startup**; **periodic PASSIVE** checkpoint while running (`DATA_WAL_CHECKPOINT_MINUTES`, default 5) |
| Empty main `.sqlite` but lost `-wal` | Worst case — looks like fresh install | Marker + **refuse to start** / deploy guard; backups |

A crash is **not** the same as a stop. We cannot run code during a crash; we reduce how much lives only in WAL and block serving an empty DB when the marker says a household existed.

## What prevents surprise empty households (Phase 11)

| Mechanism | What it does |
| --- | --- |
| `data/.household-established.json` | Written after setup and on server start when users exist. Documents that this install had a household. |
| **Startup check** | If marker exists but `users = 0` → process **exits** (container restart loops until data restored or `ALLOW_EMPTY_HOUSEHOLD=1`). |
| `GET /api/health` | Returns `stats.userCount`, `householdEstablishedOnDisk`, `dataUnexpectedlyEmpty` (marker present but DB empty). |
| `./deploy.sh` **data guard** | After deploy, if the marker exists but health reports zero users → **deploy fails** (unless `SKIP_DATA_GUARD=1`). |
| Graceful stop | `SIGTERM` runs `wal_checkpoint(TRUNCATE)` so more state lands in the main `.sqlite` file (Docker restarts send SIGTERM when possible). |
| Periodic checkpoint | While the app runs, passive WAL checkpoint every N minutes (limits data “only in WAL” if the process is killed). |
| `integrity_check` on startup | Fails fast on corruption (override `ALLOW_CORRUPT_DB=1` only for recovery). |
| **In-app scheduled backup** | Default every **24h** (`DATA_AUTO_BACKUP_HOURS`) to `data/backups/` while the container runs; see README “Household data”. |
| `./scripts/backup-data.sh` | Manual host backup (use when container is stopped or you want `sqlite3 .backup` from the host). |

## Billy / Windows + Docker (repo `data/` on `C:\...`)

- Keep `data/` in the git clone (as today). Bind mount is correct; loss comes from **empty or incomplete DB files**, not missing Docker volumes.
- After household setup once, **`git pull` + `./deploy.sh`** on the new version creates the marker on first container start (existing users).
- Optional: **Task Scheduler** weekly — WSL bash:

  ```bash
  cd /mnt/c/Users/.../Nutrition-Tracker && ./scripts/backup-data.sh
  ```

- Moving `data/` to WSL `ext4` is **optional** hardening, not required.

## Backup (operator)

```bash
./scripts/backup-data.sh
# or
BACKUP_DIR=/path/to/safe/copies ./scripts/backup-data.sh /mnt/c/.../Nutrition-Tracker/data
```

Backups default to `data/backups/nutrition-*.sqlite` (gitignored with `data/`). Copy that folder to another disk or cloud periodically.

**Before** major experiments: zip `nutrition.sqlite`, `nutrition.sqlite-wal`, `nutrition.sqlite-shm`, and `uploads/`.

## Recovery

1. Stop the stack: `docker compose down` (in the stack directory).
2. Replace `data/nutrition.sqlite` from a backup; remove stale `-wal`/`-shm` if restoring a checkpointed file-only backup taken after `backup-data.sh`.
3. Start: `./deploy.sh --skip-git`.
4. Confirm `/api/health` shows `setupRequired: false` and expected `stats`.

## Intentional fresh start

1. Stop container.
2. Remove or archive `data/` (or only `nutrition.sqlite*`).
3. Remove `data/.household-established.json` if present.
4. Deploy; complete setup again.

Or deploy with `SKIP_DATA_GUARD=1` only when you understand the DB is intentionally empty.

## Emergency override

In `.env`:

```bash
SKIP_DATA_GUARD=1
```

Use only for first-time install debugging or after deliberate data wipe.

See also [server-deploy-frankenstein.md](./server-deploy-frankenstein.md), [ROADMAP.md](../ROADMAP.md) Phase 11.
