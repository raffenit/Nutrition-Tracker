# Documentation index

Start here when you need orientation in the Nutrition Tracker repo. Deep design lives in [ARCHITECTURE.md](./ARCHITECTURE.md); planned and in-flight work in [ROADMAP.md](./ROADMAP.md).

## For agents and contributors

| Read this | When |
| --- | --- |
| [../AGENTS.md](../AGENTS.md) | Repo rules, deploy, privacy, Frankenstein mount notes (workspace parent) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Data model, API summary, privacy rules, testing gates |
| [CODE-MAP.md](./CODE-MAP.md) | **Feature → file paths** (fastest way to find code) |
| [ROADMAP.md](./ROADMAP.md) | Phases, acceptance criteria, what’s next vs done |

**Workflow:** identify the feature in [CODE-MAP.md](./CODE-MAP.md) → read the matching route/domain section in [ARCHITECTURE.md](./ARCHITECTURE.md) → implement → run `npm test` (see [Testing](#testing)).

## Product docs

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Client spec matrix, deployment, SQLite schema overview, domain modules, web routes |
| [ROADMAP.md](./ROADMAP.md) | Phases 0–9 (quick log, alerts, PDF, OpenCookbook, offline sync, polish) |
| [CODE-MAP.md](./CODE-MAP.md) | Tables linking user-facing areas to `server/` and `web/` files |
| [../README.md](../README.md) | Setup overview, STANDALONE vs EXTERNAL Caddy |
| [SETUP-WINDOWS-WSL.md](./SETUP-WINDOWS-WSL.md) | **Windows:** WSL2, Docker Desktop, Tailscale, deploy |

## Testing

From repo root:

```bash
npm test
```

Runs `scripts/run-tests.sh` → server `node --test` + web `tsc --noEmit` + optional **HTTPS smoke** when `.env` has `TAILSCALE_SERVER_URL=https://…` (hits `/api/health` over Tailscale; skip with `SKIP_HTTPS_SMOKE=1`). Full log: `local/test-last-run.log` (gitignored).

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

Update this table when a phase ships (date in ROADMAP + row here).

## Related (outside `docs/`)

| Path | Role |
| --- | --- |
| `local.example/` | Notes on gitignored `local/` (test logs); config is **`.env` only** |
| `.env.example` | Server env vars (`TZ`, `TAILSCALE_SERVER_URL`, `USDA_API_KEY`) |
| `scripts/run-tests.sh` | Canonical test runner used by deploy |
