# Playbook — Frankenstein / docker-files Nutrition Tracker

## Two paths, two jobs

| Path | Role in Cursor workspace |
| --- | --- |
| **`Projects/Apps/Nutrition-Tracker/`** | **Working directory** — all git-tracked app code, tests, docs, commit, push |
| **`Projects/docker-files/Nutrition-Tracker/`** (Frankenstein stack on SSHFS) | **Local uncommitted only** — `.env`, `data/`, other gitignored server/runtime files. **Never** edit `server/`, `web/`, or `docs/` here |

Same repo on disk at the mount, but agents treat the mount as **runtime/config**, not a second source tree.

## Allowed on the mount (examples)

- `.env` — `TAILSCALE_SERVER_URL`, `EASYOCR_*`, ports, secrets (never commit)
- `data/` — database, uploads, tessdata, EasyOCR models
- Investigating logs or compose-adjacent local state Rachael keeps uncommitted

## Not allowed on the mount (from workspace agents)

- Feature fixes in `server/`, `web/`, playbooks, CODE-MAP
- `git commit` / `git push` of application changes from the laptop via the mount clone

## Shipping new app versions

1. Change code in **Apps/Nutrition-Tracker/** → `npm test` → commit → push.
2. On **Frankenstein** (SSH or on-box shell), in the stack directory: `git pull`, `./deploy.sh --skip-git` (or full `deploy.sh` per habit).

## Before touching the mount

1. [.devinFrankenstein/AGENTS.md](../../../../.devinFrankenstein/AGENTS.md) — verify SSHFS mount is live.
2. [.devinFrankenstein/RUNBOOK.md](../../../../.devinFrankenstein/RUNBOOK.md) if mount is empty or stale.

## Debugging production

Use **Apps** [CODE-MAP.md](../CODE-MAP.md) / [label-ocr-and-parsing.md](./label-ocr-and-parsing.md). Confirm running commit (image id, built JS hash). `npm run dev` in Apps ≠ Docker (EasyOCR, prod build, `./data` on server).

[Projects/docs/AGENT-INDEX.md](../../../../docs/AGENT-INDEX.md)
