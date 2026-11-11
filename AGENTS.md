# Nutrition Tracker

## Repository

**All application source** — edit, test, commit, and push from **this repository clone**.

**Production / stack directory** on the host: use only for **local, uncommitted server files** — e.g. `.env`, `data/` (SQLite, uploads, models), other gitignored runtime state. Do **not** treat the server tree as the place to edit tracked paths (`server/`, `web/`, `docs/`, …). Ship code changes from your dev clone → push → on the host `git pull` + `./deploy.sh` (see [server-deploy-production.md](./docs/playbooks/server-deploy-production.md)).

TypeScript only: API in `server/` (Node 22), UI in `web/` (React 19 + Vite). Household data stays in `data/` and is not committed.

Default server release: **`./deploy.sh`** (`CADDY_STYLE` in `.env`). Tests: **`npm test`** runs **server typecheck (both tsconfigs)**, **server `node --test`**, and **web `tsc --noEmit`** — all required; see [docs/testing-standards.md](./docs/testing-standards.md). Log: `local/test-last-run.log`. Server test layout: [server/src/test/README.md](./server/src/test/README.md). Windows hosts: WSL2 — [docs/SETUP-WINDOWS-WSL.md](./docs/SETUP-WINDOWS-WSL.md).

## Finding code (no line numbers)

1. **[docs/CODE-MAP.md](./docs/CODE-MAP.md)** — feature → paths and **export/symbol names**.
2. **[docs/playbooks/](./docs/playbooks/README.md)** — OCR, import UI, family privacy.
3. **Search** — ripgrep for the symbol from the map (e.g. `readSodiumFromMacroGap`, `receiveUpload`).

Do not rely on remembered line numbers or line-based structure docs. This repo uses **CODE-MAP + playbooks**, not `STRUCTURE.md`.

Read [docs/README.md](./docs/README.md) for the doc index and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) before structural changes. Planned work is in [docs/ROADMAP.md](./docs/ROADMAP.md). Production deploy: [docs/playbooks/server-deploy-production.md](./docs/playbooks/server-deploy-production.md).

When you add or move domain/integration/import modules, update **CODE-MAP** (and a playbook if it’s a common task) in the same change.

Weight records are personal. Family and kiosk responses go through `server/src/domain/familyView.ts` and must not include them.

Host-specific URLs and deploy options belong in `.env`. Private host playbooks and real label photos belong in gitignored `local/` or `docs/local/` (see `local.example/`).

Do not restart production infrastructure (Caddy) or this container until the pending change has been reviewed.

## Parsing and imports

Prefer **universal layout algorithms** over hardcoded strings or one-off fixes for a single label photo. Classify by **layout pattern** (single Nutrition Facts block, repeated headings, multi-column macro table), not by brand, retailer, or photo filename.
