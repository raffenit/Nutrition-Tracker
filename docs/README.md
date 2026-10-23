# Documentation index

Start here when you need orientation in the Nutrition Tracker repo. Deep design lives in [ARCHITECTURE.md](./ARCHITECTURE.md); planned and in-flight work in [ROADMAP.md](./ROADMAP.md).

## For agents and contributors

| Read this | When |
| --- | --- |
| [../AGENTS.md](../AGENTS.md) | Repo rules, deploy, privacy, Frankenstein mount notes (workspace parent) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Data model, API summary, privacy rules, testing gates |
| [CODE-MAP.md](./CODE-MAP.md) | **Feature → file paths and symbol names** (start here to find code) |
| [playbooks/](./playbooks/README.md) | Task guides (OCR, import UI, privacy) — no line numbers |
| [ROADMAP.md](./ROADMAP.md) | Phases, acceptance criteria, what’s next vs done |

**Workflow:** [CODE-MAP.md](./CODE-MAP.md) or a [playbook](./playbooks/README.md) → grep the listed **symbol** → read [ARCHITECTURE.md](./ARCHITECTURE.md) if the shape of the system changes → implement → update CODE-MAP if you added modules → `npm test` (see [Testing](#testing)).

## Product docs

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Client spec matrix, deployment, SQLite schema overview, domain modules, web routes |
| [ROADMAP.md](./ROADMAP.md) | Phases 0–9 (quick log, alerts, PDF, OpenCookbook, offline sync, polish) |
| [CODE-MAP.md](./CODE-MAP.md) | Tables linking features to `server/` and `web/` files and key exports |
| [playbooks/](./playbooks/README.md) | Short agent walkthroughs for OCR, import UI, privacy |
| [../README.md](../README.md) | Setup overview, STANDALONE vs EXTERNAL Caddy |
| [SETUP-WINDOWS-WSL.md](./SETUP-WINDOWS-WSL.md) | **Windows:** WSL2, Docker Desktop, Tailscale, deploy |

## Testing

From repo root:

```bash
npm test
```

Runs `scripts/run-tests.sh` → server `node --test` on all `dist-test/**/*.test.js` + web `tsc --noEmit`. Layout: [server/src/test/README.md](../server/src/test/README.md). **HTTPS smoke** runs at end of **`./deploy.sh`** (after Docker health), not during `npm test`; skip with `SKIP_HTTPS_SMOKE=1` in `.env`. Logs: `local/test-last-run.log` (full test run), `local/https-smoke-last.txt` (last smoke step when it runs).

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
