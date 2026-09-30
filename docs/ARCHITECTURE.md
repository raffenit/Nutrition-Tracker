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
| Goal alerts | Not implemented (only weekly weight reminder banner when enabled) |
| Family tracking | `/family` and kiosk token; shared day view per member |
| Self-hosted, phone access | Docker + Caddy on `:3010` + Tailscale; PWA manifest (no push SW yet) |

Extras built beyond the original list: hydration tracking, imperial/metric units, Open Food Facts + optional USDA ingredient search, favorites, drink → hydration rollup.

## Deployment topology

```text
Phone / tablet / HA panel (Tailscale)
        │
        ▼
Caddy (shared infrastructure stack, media-network)
  :3010 → nutrition-tracker:3010
        │
        ▼
Docker container (Nutrition-Tracker/Dockerfile)
  Node 22 serves API + static web bundle
  /data → host ./data (SQLite + uploads + tessdata cache)
```

- **Deploy:** `./deploy.sh` from the repo root (recommended), or `docker compose up -d --build` without tests/git.

### Deploy script

Default `./deploy.sh` pipeline (override with `--skip-test` / `--skip-git`):

1. **Tests** — root `npm test` → `scripts/run-tests.sh` runs server unit/integration tests and `web/` `tsc --noEmit`. Full console output is mirrored to gitignored **`local/test-last-run.log`** (overwrite each run).
2. **Git** — if the working tree is dirty, `git add -A` and commit (requires `-m "…"` or `DEPLOY_COMMIT_MSG` in `local/deploy.env`); if `HEAD` is ahead of upstream, `git push`.
3. **Docker** — verify `media-network`, `docker compose up -d --build`, poll `GET /api/health` on `NUTRITION_PORT` (default 3010).

Host prerequisites: Docker, **Node/npm** (install deps in repo root + `server/` + `web/` once), **git** with push access to `origin`.
- **Caddy:** port `3010` must be defined in your infrastructure `Caddyfile` and published on the Caddy container.
- **Host-specific paths/URLs:** `local/deploy.env` (gitignored; see `local.example/`).

Environment (see `.env.example`, server admin only — not per user):

- `TZ` — household day boundaries
- `PUBLIC_URL` — kiosk link generation in Settings
- `USDA_API_KEY` — optional; enables USDA hits in `/api/ingredients/search` (Open Food Facts + library still work without it)

Deploy-only overrides (`REMOTE_BASE_URL`, `INFRA_COMPOSE_DIR`) live in gitignored `local/deploy.env`; see `local.example/`.

## Repository layout

| Path | Role |
| --- | --- |
| `server/` | TypeScript API, SQLite, OCR/PDF, domain logic |
| `web/` | React 19 + Vite SPA (client-side routing via `history.pushState`) |
| `Dockerfile` | Multi-stage: build web, compile server, single runtime image |
| `data/` | Runtime only — database, uploads, not in git |
| `docs/` | Architecture (this file) and roadmap |

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
| Logs | `POST /api/logs`, `DELETE /api/logs/:id`, hydration POST/DELETE |
| Dashboard | `GET /api/dashboard?date=&days=` — day totals, targets, weight reminder state, trends |
| Family | `GET /api/family?date=` — kiosk or logged-in reader |
| Weight | `GET/PUT/POST/DELETE /api/weight`, dismiss reminder |

Logging today **requires** a `foodId` (`server/src/routes/logRoutes.ts`); ad-hoc logs without library are a planned change (see roadmap).

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
| `/add` | Add log | Search library; link to new label food |
| `/library` | Library | Favorites, new label, custom meal |
| `/foods/new`, `/foods/custom` | FoodPage | Label/manual/PDF vs composed meal |
| `/family` | Family board | Kiosk mode restricts nav |
| `/settings` | Targets, users, weight prefs, kiosk URL |

API client: `web/src/api/client.ts` (credentials included for cookies).

## Privacy and security rules

1. **Weight never leaves personal APIs** — family and kiosk payloads go through `toFamilyBoard` / `assertFamilyBoardIsPublic`; integration tests guard this.
2. **Uploads and foods** are household-shared; meal logs are per-user.
3. **Kiosk token** is hashed at rest; display URL built with `PUBLIC_URL` when set.

## Testing

`npm test` runs **two gates** (see `scripts/run-tests.sh`). Both must pass for deploy; a green server test count does **not** mean the web app is OK.

| Gate | What it checks |
| --- | --- |
| **Server** | Node native `test` runner — domain unit tests (`parseLabel`, `parseMenuTable`, `time`, `familyView`, `trends`, weight reminder) and HTTP integration (`server/src/test/api.test.ts`), including API shapes the web UI relies on (e.g. recipe `ingredients` on `GET /api/foods/:id`). |
| **Web** | `tsc --noEmit` — React/TS must compile; catches missing fields on shared DTOs like `Food`. No component tests yet. |

Run from repo root: `npm test`. The log ends with an explicit **Summary** (`Server tests` / `Web typecheck` / `Overall`). Full transcript: **`local/test-last-run.log`** (overwrite each run).

## Design choices (why it looks like this)

- **Monolith container** — one process serves API + static assets; simple ops on a single Docker host.
- **SQLite** — single-household scale, easy backup (`data/` volume).
- **No React Router** — small route set, HA kiosk only needs a few paths.
- **Compose API** — custom meals are first-class foods with ingredient rows, so logging reuses the same `/api/logs` path.

## Related docs

- [ROADMAP.md](./ROADMAP.md) — planned work, phases, acceptance criteria.
- [../README.md](../README.md) — build, test, deploy commands.
