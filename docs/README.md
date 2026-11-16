# Documentation index

Start here when you need orientation in the Nutrition Tracker repo. Deep design lives in [ARCHITECTURE.md](./ARCHITECTURE.md); planned and in-flight work in [ROADMAP.md](./ROADMAP.md).

## For agents and contributors

| Read this | When |
| --- | --- |
| [../AGENTS.md](../AGENTS.md) | Repo rules, deploy, privacy |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Data model, API summary, privacy rules, testing gates |
| [testing-standards.md](./testing-standards.md) | Quick vs full test tiers, typecheck gates, manual OCR |
| [CODE-MAP.md](./CODE-MAP.md) | **Feature → file paths and symbol names** (start here to find code) |
| [playbooks/](./playbooks/README.md) | Task guides (OCR, import UI, privacy, production deploy) |
| [ROADMAP.md](./ROADMAP.md) | Phases, acceptance criteria, what’s next vs done |

**Workflow:** [CODE-MAP.md](./CODE-MAP.md) or a [playbook](./playbooks/README.md) → grep the listed **symbol** → read [ARCHITECTURE.md](./ARCHITECTURE.md) if the shape of the system changes → implement → update CODE-MAP if you added modules → `npm run test:quick` (see [Testing](#testing)); `npm test` before deploy.

## Product docs

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Client spec matrix, deployment, SQLite schema overview, domain modules, web routes |
| [ROADMAP.md](./ROADMAP.md) | Phases 0–9 (quick log, alerts, PDF, OpenCookbook, offline sync, polish) |
| [CODE-MAP.md](./CODE-MAP.md) | Tables linking features to `server/` and `web/` files and key exports |
| [playbooks/](./playbooks/README.md) | Short agent walkthroughs for OCR, import UI, privacy |
| [../README.md](../README.md) | Setup overview, STANDALONE vs EXTERNAL Caddy, **household data & backups** |
| [SETUP-WINDOWS-WSL.md](./SETUP-WINDOWS-WSL.md) | **Windows:** WSL2, Docker Desktop, Tailscale, deploy |

## Testing

From repo root:

```bash
npm run test:quick   # after edits (~10s)
npm test             # full gate / deploy parity (~2 min)
```

Quick: `scripts/run-tests-quick.sh` (excludes `*localFixtures*`). Full: `scripts/run-tests.sh` — see [testing-standards.md](./testing-standards.md). **HTTPS smoke** runs in **`./deploy.sh`**, not in either tier. Logs: `local/test-last-run-quick.log`, `local/test-last-run.log`.

Before any PR that touches logs or family APIs, use the privacy checklist in [ROADMAP.md — Tracking](./ROADMAP.md#tracking).

## Implementation status (roadmap snapshot)

| Phase | Topic | Status |
| --- | --- | --- |
| 0 | Docs baseline | Done |
| 1 | Quick ad-hoc log (no library) | Done — `/add` Quick entry, `POST /api/logs` with `adHoc` |
| 2 | Recipe `makesServings` UI | Done in `FoodPage.tsx` |
| 3 | Weight history view | Done — `/weight`, 30/90d chart + list, delete entry |
| 4a | In-app goal alerts | Done — dashboard `alerts`, dismiss API |
| 4b | Web Push goal alerts | Done — VAPID, SW, Settings opt-in (needs HTTPS URL) |
| 5 | Restaurant PDF workflow | Done — review, loose row parse, batch stubs |
| 7 | OpenCookbook (plan + grocery) | Partial — Plan tab, meal plan API, Markdown export |
| 8 | Polish / handoff | Ongoing |
| 9 | Offline PWA + sync | Done — outbox, pins, offline library/today (import still online-only) |
| 10 | Meal-kit recipe cards | In progress — PDF import, instructions |
| 11 | Data persistence + backup | Done — deploy guard, scheduled backups, [playbook](./playbooks/data-backup-recovery.md) |
| 12 | Multi-label photo/PDF import | Planned — `local/test-images/` for manual checks; pick one vs import all |
| 13 | Tags (foods + ingredients) | Planned — overlapping tags, library filter; optional `drink` tag with hydration toggle |

Update this table when a phase ships (date in ROADMAP + row here).

## Related (outside `docs/`)

| Path | Role |
| --- | --- |
| `local.example/` | Notes on gitignored `local/` (test logs); config is **`.env` only** |
| `.env.example` | Server env vars (`TZ`, `TAILSCALE_SERVER_URL`, `USDA_API_KEY`) |
| `scripts/run-tests.sh` | Canonical test runner used by deploy |
