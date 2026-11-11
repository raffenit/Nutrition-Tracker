# Host-specific files (optional)

The **`local/`** directory at the repo root is **gitignored** — use it for machine-local artifacts, not a second config file.

## Configuration

Use a **single `.env`** (from `.env.example`) for the app **and** `./deploy.sh`. There is no `local/deploy.env` anymore; deploy deletes that file if it still exists from older installs.

## What goes in `local/`

| Path | Purpose |
| --- | --- |
| `local/test-last-run.log` | Written by `npm test` / deploy |
| `local/https-smoke-last.txt` | Last HTTPS smoke output (when enabled) |
| **`local/test-images/`** | Real label photos for manual OCR / import experiments |
| **`local/test-images/manifest.json`** | Ground truth per photo (copy from `local.example/test-images-manifest.example.json`) |

You can store private notes under `local/` if you want; nothing here is committed.

## Private documentation (not in the public repo)

| Location | Use for |
| --- | --- |
| **`local/`** (any path) | Host playbooks, SSH/mount notes, machine names, one-off deploy runbooks |
| **`docs/local/`** | Same, if you prefer keeping markdown under `docs/` (also gitignored) |

Tracked **`docs/playbooks/`** and **`AGENTS.md`** should stay generic (no named servers, households, or private URLs). Copy the production playbook pattern and fill in host details only under `local/` or `docs/local/`.
