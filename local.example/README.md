# Host-specific configuration (optional)

The main repo stays generic. Put **your** Tailscale URL and non-default paths in `local/` at the repo root.

That directory is **gitignored** — nothing here is committed.

## `.env` vs `local/deploy.env`

| File | Used by |
| --- | --- |
| `.env` (from `.env.example`) | **Docker / the app** — timezone, `PUBLIC_URL`, `USDA_API_KEY` |
| `local/deploy.env` | **`./deploy.sh` only** — convenience output and infra path overrides |

Household members do not configure either file; the person who runs the server does.

## Setup

```bash
cp .env.example .env
cp local.example/deploy.env.example local/deploy.env
```

Edit both with your Tailscale IP (`tailscale ip -4` on the server).

You can add other private notes under `local/` (backup paths, etc.).
