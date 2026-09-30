# Nutrition Tracker

TypeScript only: API in `server/` (Node 22), UI in `web/` (React 19 + Vite). Household data stays in `data/` and is not committed.

Default server release: `./deploy.sh -m "message"` (tests → commit/push if needed → Docker). Test log: `local/test-last-run.log`.

Read `docs/ARCHITECTURE.md` before structural changes. Planned work is in `docs/ROADMAP.md` (phases: quick log, meal servings UI, weight view, goal alerts, PDF workflow).

Weight records are personal. Family and kiosk responses go through `server/src/domain/familyView.ts` and must not include them.

Host-specific deploy paths and URLs belong in `local/` (gitignored); see `local.example/`.

Do not restart production infrastructure (Caddy) or this container until the pending change has been reviewed.
