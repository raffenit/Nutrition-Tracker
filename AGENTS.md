# Nutrition Tracker

TypeScript only: API in `server/` (Node 22), UI in `web/` (React 19 + Vite). Household data stays in `data/` and is not committed.

Default server release: **`./deploy.sh`** (`CADDY_STYLE` in `.env`). Tests: `npm test` (all `server/dist-test/**/*.test.js`); log `local/test-last-run.log`. Server test layout: [server/src/test/README.md](./server/src/test/README.md). Windows hosts: WSL2 — [docs/SETUP-WINDOWS-WSL.md](./docs/SETUP-WINDOWS-WSL.md).

## Finding code (no line numbers)

1. **[docs/CODE-MAP.md](./docs/CODE-MAP.md)** — feature → paths and **export/symbol names**.
2. **[docs/playbooks/](./docs/playbooks/README.md)** — OCR, import UI, family privacy.
3. **Search** — ripgrep for the symbol from the map (e.g. `readSodiumFromMacroGap`, `receiveUpload`).

Do not rely on remembered line numbers or line-based structure docs. This repo uses **CODE-MAP + playbooks**, not `STRUCTURE.md`. Workspace rule: [`.devin/rules/navigation.md`](../.devin/rules/navigation.md).

Read [docs/README.md](./docs/README.md) for the doc index and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) before structural changes. Planned work is in [docs/ROADMAP.md](./docs/ROADMAP.md).

When you add or move domain/integration/import modules, update **CODE-MAP** (and a playbook if it’s a common task) in the same change.

Weight records are personal. Family and kiosk responses go through `server/src/domain/familyView.ts` and must not include them.

Host-specific URLs and deploy options belong in `.env`; `local/` is for test logs only (see `local.example/`).

Do not restart production infrastructure (Caddy) or this container until the pending change has been reviewed.

## Parsing and imports

Prefer **universal layout algorithms** over hardcoded strings or one-off fixes for a single label photo. See `.cursor/rules/universal-algorithms.mdc` in this repo and the workspace copy under `Projects/.cursor/rules/`.
