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

## Before editing a remote/mounted stack tree

1. Confirm the mount or SSH path is the live stack (expected `docker-compose.yml`, populated `data/`).
2. If the path is empty or stale, restore access before changing `.env` or `data/`.

## Debugging production

Use [CODE-MAP.md](../CODE-MAP.md) and [label-ocr-and-parsing.md](./label-ocr-and-parsing.md). Confirm running commit (image id, built JS hash). `npm run dev` on a laptop ≠ Docker (EasyOCR, prod build, host `./data`).

## Which build is running?

`./deploy.sh` stamps the image with the deployed commit. The health step prints `Running build: <commit> (committed <time>)` and warns if the container reports a different commit than the one just built. Check any time with:

```bash
curl -s http://127.0.0.1:3010/api/health   # "build": { "commit": "abc1234", "committedAt": "…" }
```

`unknown` means the image was built without `deploy.sh` (e.g. a bare `docker compose up --build`); a `-dirty` suffix means tracked files had uncommitted edits.
