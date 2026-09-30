# Host-specific configuration (optional)

The main repo stays generic. Put **your** server paths, Tailscale URLs, and deploy overrides in a `local/` directory at the repo root.

That directory is **gitignored** — nothing here is committed.

## Setup

```bash
cp local.example/deploy.env.example local/deploy.env
```

Edit `local/deploy.env` with your values. `./deploy.sh` loads it automatically when present.

You can also add other private notes in `local/` (SSH aliases, backup paths, etc.).
