# Playbook — production server deploy

## Repository clone vs runtime state

| Location | Role |
| --- | --- |
| **This git clone** | Application source — edit, test, commit, push |
| **Host stack directory** (same repo on the server) | **Uncommitted runtime only** — `.env`, `data/` (SQLite, uploads, models). Keep application changes in git; do not treat the server tree as a second source fork |

Some teams keep a **second local path** (SSHFS, sync, or remote-only) that mirrors only the stack directory for editing `.env` and inspecting `data/`. If you use that pattern, **never** commit application code from that mirror — ship via the main clone → push → `git pull` on the server.

## Allowed runtime-only changes (examples)

- `.env` — `TAILSCALE_SERVER_URL`, `EASYOCR_*`, ports, secrets (never commit)
- `data/` — database, uploads, tessdata, EasyOCR models
- Container logs and compose-adjacent local state

## Not allowed on runtime-only mirrors

- Feature fixes in `server/`, `web/`, playbooks, CODE-MAP
- `git commit` / `git push` of application changes from a mirror that is not your primary dev clone

## Shipping new app versions

1. Change code in your dev clone → `npm test` → commit → push.
2. On the **production host** (SSH or on-box shell), in the stack directory: `git pull`, `./deploy.sh --skip-git` (or full `./deploy.sh`).

## When a deploy or test run fails

`deploy.sh`, `standalone-deploy.sh`, `external-deploy.sh`, `scripts/run-tests.sh` and `scripts/run-tests-quick.sh` source `scripts/lib-failure-report.sh`. Any non-zero exit prints a red `DEPLOY FAILED` / `TEST RUN FAILED` banner on stderr with the step (`[3/6] Building…`), the exit code, and the last failing command with `file:line`. A failure can never end the script silently. New deploy steps should use `deploy_step "[n/6] …"` so the banner names them.

## Before editing a remote/mounted stack tree

1. Confirm the mount or SSH path is the live stack (expected `docker-compose.yml`, populated `data/`).
2. If the path is empty or stale, restore access before changing `.env` or `data/`.

## Debugging production

Use [CODE-MAP.md](../CODE-MAP.md) and [label-ocr-and-parsing.md](./label-ocr-and-parsing.md). Confirm running commit (image id, built JS hash). `npm run dev` on a laptop ≠ Docker (EasyOCR, prod build, host `./data`).
