# Nutrition Tracker

TypeScript only: API in `server/` (Node 22), UI in `web/` (React 19 + Vite). Household data stays in `data/` and is not committed.

Default server release: **`./deploy.sh`** (`CADDY_STYLE` in `.env`). Tests: `npm test` (all `server/dist-test/**/*.test.js`); log `local/test-last-run.log`. Server test layout: [server/src/test/README.md](./server/src/test/README.md). Windows hosts: WSL2 — [docs/SETUP-WINDOWS-WSL.md](./docs/SETUP-WINDOWS-WSL.md).

Read `docs/README.md` for the doc index and `docs/CODE-MAP.md` to find files by feature. Read `docs/ARCHITECTURE.md` before structural changes. Planned work is in `docs/ROADMAP.md` (phases: quick log, weight view, goal alerts, PDF workflow).

Weight records are personal. Family and kiosk responses go through `server/src/domain/familyView.ts` and must not include them.

Host-specific URLs and deploy options belong in `.env`; `local/` is for test logs only (see `local.example/`).

Do not restart production infrastructure (Caddy) or this container until the pending change has been reviewed.

## Parsing and imports

Prefer **universal layout algorithms** over hardcoded strings or one-off fixes for a single label photo. See `.cursor/rules/universal-algorithms.mdc` in this repo and the workspace copy under `Projects/.cursor/rules/`.
