# Host-specific files (optional)

The **`local/`** directory at the repo root is **gitignored** — use it for machine-local artifacts, not a second config file.

## Configuration

Use a **single `.env`** (from `.env.example`) for the app **and** `./deploy.sh`. There is no `local/deploy.env` anymore; deploy deletes that file if it still exists from older installs.

## What goes in `local/`

| Path | Purpose |
| --- | --- |
| `local/test-last-run.log` | Written by `npm test` / deploy |
| `local/https-smoke-last.txt` | Last HTTPS smoke output (when enabled) |

You can store private notes under `local/` if you want; nothing here is committed.
