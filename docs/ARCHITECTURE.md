# Nutrition Tracker — architecture

Household nutrition app for phones, tablets, and a Home Assistant panel. One self-hosted server, per-person logs and goals, shared food library, and a public family board (no weight).

## Goals and client spec (baseline)

| Client requirement | How it works today |
| --- | --- |
| Manual nutrition for individual items | Library → **New from a label** (typed fields, no scan required) → log via **+** |
| Meals from ingredients ÷ servings | **Custom meal** (`POST /api/foods/compose`); nutrients stored per serving on the food record |
| Scan nutrition labels | Image upload → Tesseract OCR → `parseNutritionLabel` → review → save |
| Scan restaurant PDF sheets | PDF text → if not label-shaped, `menuCandidates` names; user enters nutrition manually |
| Weight over time (optional) | Opt-in in Settings; `weight_entries`; sparkline on Today **Trends**; never on `/api/family` |
| Stats: calories, protein, fiber, salt | Today dashboard: macro pie, goal cards (sodium = salt), 7/14d trends |
| Set goals | Settings → targets + optional extra nutrients (`targets.extras_json`) |
| Goal alerts | In-app banners on personal dashboard (`domain/alerts.ts`); dismiss per day; weekly weight reminder separate |
| Family tracking | `/family` and kiosk token; shared day view per member |
| Self-hosted, phone access | Docker + Caddy on `:3010` + Tailscale; PWA manifest + service worker (push + offline shell) |

Extras built beyond the original list: hydration tracking, imperial/metric units, Open Food Facts + optional USDA ingredient search, favorites, drink → hydration rollup.

## Deployment topology

**STANDALONE** (`CADDY_STYLE=STANDALONE`, deploy via **`./deploy.sh`**): bundled `nutrition-caddy` in this repo publishes `:3010` → `nutrition-tracker`.

**EXTERNAL** (`CADDY_STYLE=EXTERNAL`, deploy via **`./deploy.sh`**): sibling `infrastructure/` Caddy on `media-network` publishes `:3010` → `nutrition-tracker`.

```text
Phone / tablet / HA panel (Tailscale)
        │
        ▼
Caddy :3010  (standalone nutrition-caddy OR shared infrastructure)
        │
        ▼
nutrition-tracker container — Node 22, API + static web
  /data → host ./data (SQLite + uploads + tessdata)
```

- **Deploy:** **`./deploy.sh`** (reads `CADDY_STYLE` from `.env`).
- **Windows:** WSL2 + Docker Desktop — [SETUP-WINDOWS-WSL.md](./SETUP-WINDOWS-WSL.md).

### Deploy script

Pipeline (override with `--skip-test` / `--skip-git`):

1. **Tests** — `npm test` → `local/test-last-run.log`
2. **Git** — optional commit/push
3. **Docker** — STANDALONE merges `docker-compose.standalone.yml`; EXTERNAL requires existing `media-network`
4. **Health** — `GET /api/health` on `NUTRITION_PORT` (default 3010)

Host prerequisites: Docker; Node/npm for tests; git optional. **Host URL:** `TAILSCALE_SERVER_URL` in `.env`.

Environment (see `.env.example`, server admin only — not per user):

- `TZ` — household day boundaries
- `TAILSCALE_SERVER_URL` — Tailscale server URL for kiosk links (tailnet only; no port in value); legacy `PUBLIC_URL` supported; `NUTRITION_PORT` — HTTP port on Tailscale IP (default 3010)
- `USDA_API_KEY` — optional; enables USDA hits in `/api/ingredients/search` (Open Food Facts + library still work without it)

Optional deploy-only keys in **`.env`**: `INFRA_COMPOSE_DIR`, `DEPLOY_COMMIT_MSG` (see `.env.example`).

## Repository layout

| Path | Role |
| --- | --- |
| `server/` | TypeScript API, SQLite, OCR/PDF, domain logic |
| `web/` | React 19 + Vite SPA (client-side routing via `history.pushState`) |
| `Dockerfile` | Multi-stage: build web, compile server, single runtime image |
| `data/` | Runtime only — database, uploads, not in git |
| `docs/` | [Index](./README.md), architecture (this file), [code map](./CODE-MAP.md), roadmap |

Root scripts: `npm test` (via `scripts/run-tests.sh` → `local/test-last-run.log`), `npm run build`.

## Runtime stack

All application code is **TypeScript**. There is no second runtime (no Python/Rust service in this repo).

- **Server:** Node 22, native `http`, hand-rolled router (`server/src/http/router.ts`), `better-sqlite3`, `busboy` uploads, `tesseract.js`, `sharp`, `pdf-parse`.
- **Web:** React 19 + Vite, no React Router — path → page map in `web/src/App.tsx`.
- **Auth:** Cookie sessions (`sessions` table); kinds `user` and `kiosk` (family display).

Entry: `server/src/index.ts` listens; `server/src/server.ts` wires DB + routes; `server/src/http/handle.ts` matches routes, auth, JSON/static.

## Data model (SQLite)

Core tables in `server/src/db/database.ts`:

- **users / sessions / household** — multi-user household, timezone, optional kiosk token hash.
- **targets** — per-user calories, protein, fiber, fat, carbs, sodium, hydration, `units` (metric/imperial), `extras_json` for custom tracked nutrients.
- **foods / food_ingredients** — shared library; `makes_servings` for composed meals; `kind` (packaged, ingredient, restaurant, custom); `source` (manual, image, pdf, api, composed).
- **uploads** — stored files + extracted text, optional link to food.
- **meal_logs / hydration_logs** — per-user day logs; slots: meal, snack, dessert, drink.
- **weight_preferences / weight_entries / weight_dismissals** — personal only; comments in schema warn family queries away.

Day boundaries use household timezone (`America/Chicago` default via `TZ` / household record).

## API surface (summary)

| Area | Endpoints |
| --- | --- |
| Health / session | `GET /api/health`, `GET /api/session` |
| Setup / auth | `POST /api/setup`, login/logout, users (admin) |
| Targets / household | `GET/PUT /api/targets`, `PUT /api/household`, `POST /api/household/kiosk` |
| Foods | `GET/POST/PATCH/DELETE /api/foods`, `POST /api/foods/compose`, `GET /api/ingredients/search`, `POST /api/uploads` |
| Logs | `POST /api/logs` (library `foodId` or `adHoc`), `DELETE /api/logs/:id`, hydration POST/DELETE |
| Dashboard | `GET /api/dashboard?date=&days=` — totals, targets, `alerts`, weight reminder, trends |
| Alerts | `POST /api/alerts/dismiss` — personal dashboard only |
| Family | `GET /api/family?date=` — kiosk or logged-in reader |
| Weight | `GET /api/weight?historyDays=`, `PATCH/DELETE /api/weight/:id`, prefs, dismiss reminder, erase all |

## Domain logic (server)

| Module | Responsibility |
| --- | --- |
| `domain/parseLabel.ts` | Nutrition Facts regex parsing; `menuCandidates` for unstructured menu text |
| `domain/menuTableSchema.ts` + `domain/parseMenuTable.ts` | Header-driven table parsing (HTML `<table>`, markdown pipe rows); infers columns (calories, macros, serving) without per-restaurant parsers |
| `domain/nutritionImport.ts` | Label vs menu detection; builds `menuItems[]` for URL/PDF/HTML import |
| `integrations/importUrl.ts` | SSRF-safe fetch for link import; `htmlText.ts` for text + JSON-LD |
| `domain/compose.ts` | Sum ingredient nutrients, `perServing(total, makesServings)` |
| `domain/nutrients.ts` | Scaling, rounding, extras validation, default targets |
| `domain/day.ts` | Aggregate meal + hydration into day totals |
| `domain/trends.ts` + `db/trends.ts` | Rolling series for dashboard (calories, protein, hydration; weight if enabled) |
| `domain/familyView.ts` | Strip private fields; `assertFamilyBoardIsPublic` (tests enforce no weight) |
| `domain/weight.ts` | Reminder weekday, week keys, dismissals |
| `domain/units.ts` | Glass volume for imperial vs metric hydration UI |
| `domain/time.ts` | Chicago/household TZ, local dates |
| `integrations/usda.ts`, `openFoodFacts.ts` | Ingredient search for custom meals |
| `integrations/extractText.ts` | PDF and image OCR |

## Web app structure

| Route | Page | Notes |
| --- | --- | --- |
| `/` | Dashboard | Date bar, goals, pie, hydration, trends, weight reminder, log FAB |
| `/add` | Add log | Library picker or **Quick entry** (ad-hoc, no `foods` row) |
| `/weight` | Weight history | Personal 30/90d chart + entries when check-ins enabled |
| `/library` | Library | Favorites, new label, custom meal |
| `/foods/new`, `/foods/custom` | FoodPage | Label/manual/PDF vs composed meal |
| `/family` | Family board | Kiosk mode restricts nav |
| `/settings` | Targets, users, weight prefs, kiosk URL |

API client: `web/src/api/client.ts` (credentials included for cookies).

## Privacy and security rules

1. **Weight never leaves personal APIs** — family and kiosk payloads go through `toFamilyBoard` / `assertFamilyBoardIsPublic`. Unit tests enforce `assertFamilyBoardIsPublic`; HTTP integration tests check cookie-authenticated `GET /api/family` responses. Kiosk-session HTTP coverage is planned separately.
2. **Uploads and foods** are household-shared; meal logs are per-user.
3. **Kiosk token** is hashed at rest; display URL built from `TAILSCALE_SERVER_URL` + `NUTRITION_PORT` when set.

## Testing

`npm test` runs **two gates** (see `scripts/run-tests.sh`). Both must pass for deploy unless you use `./deploy.sh --skip-test`; a green server test count does **not** mean the web app is OK.

| Gate | What it checks |
| --- | --- |
| **Server** | Node native `test` runner over **all** compiled `dist-test/**/*.test.js` files (see [server/src/test/README.md](../server/src/test/README.md)). Includes unit tests under `test/unit/domain/` (parsers, alerts, push rules, family board, trends, diet presets, grocery math, public origin), `test/unit/integrations/` (URL import SSRF + HTML helpers), and HTTP integration in `test/integration/api.test.ts` (health, setup, dashboard, family privacy string check, trends, ad-hoc logs, idempotent logs, goal alerts, weight APIs, compose/recipe shapes). |
| **Web** | `tsc --noEmit` — React/TS must compile; catches missing fields on shared DTOs like `Food`. No component or browser tests yet. |

**Host Node:** `server/package.json` requires **Node ≥ 22.13** for `npm test`; README deploy steps describe **22+** on the host.

Run from repo root: `npm test`. The log ends with an explicit **Summary** (`Server tests` / `Web typecheck` / `Overall`). Full transcript: **`local/test-last-run.log`** (overwrite each run). **HTTPS smoke** runs after Docker health in `./deploy.sh` only; output also appended to **`local/https-smoke-last.txt`** when that step runs.

**Known gaps (behavior not yet automated)** — hydration and log-delete routes, kiosk-token family board HTTP, compose per-serving math end-to-end, meal-plan/grocery HTTP, Web Push subscribe/send routes, upload/OCR/PDF HTTP, multi-user family board, and web offline/PWA runtime. See [ROADMAP.md](./ROADMAP.md) phases for product context; privacy/kiosk HTTP tests are planned last.

## Design choices (why it looks like this)

- **Monolith container** — one process serves API + static assets; simple ops on a single Docker host.
- **SQLite** — single-household scale, easy backup (`data/` volume).
- **No React Router** — small route set, HA kiosk only needs a few paths.
- **Compose API** — custom meals are first-class foods with ingredient rows, so logging reuses the same `/api/logs` path.

## Related docs

- [README.md](./README.md) — documentation table of contents and roadmap status snapshot.
- [CODE-MAP.md](./CODE-MAP.md) — feature → source file paths.
- [ROADMAP.md](./ROADMAP.md) — planned work, phases, acceptance criteria.
- [../README.md](../README.md) — build, test, deploy commands.
