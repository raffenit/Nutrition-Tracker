# Code map — feature → files

Use this to jump straight to code. Types are mirrored in `server/src/types.ts` and `web/src/types.ts` unless noted.

## Entry points

| What | Path |
| --- | --- |
| HTTP server bootstrap | `server/src/index.ts`, `server/src/server.ts` |
| Route registration | `server/src/server.ts` (lists all `*Routes()`) |
| Router | `server/src/http/router.ts` |
| Auth + JSON handler | `server/src/http/handle.ts` |
| SQLite schema + migrations | `server/src/db/database.ts` |
| SPA route → page | `web/src/App.tsx` |
| API client (cookies) | `web/src/api/client.ts` |
| Offline cache + sync outbox | `web/src/offline/` (`db.ts`, `mutations.ts`, `sync.ts`, `pending.ts`) |
| Service worker (shell + push) | `web/public/sw.js` |
| Global styles | `web/src/styles.css` |

## Routes (server)

| Prefix / area | File |
| --- | --- |
| Setup, login, targets, diet presets | `server/src/routes/authRoutes.ts` |
| Dashboard, family board | `server/src/routes/boardRoutes.ts` |
| Foods, uploads, compose, search | `server/src/routes/foodRoutes.ts` |
| Meal + hydration logs | `server/src/routes/logRoutes.ts` |
| Weight prefs + entries | `server/src/routes/weightRoutes.ts`, `server/src/routes/weightStatus.ts` |
| Meal plan (OpenCookbook) | `server/src/routes/mealPlanRoutes.ts` |
| Goal alert dismiss | `server/src/routes/alertRoutes.ts` |

## Web pages

| URL path | Component |
| --- | --- |
| `/` | `web/src/pages/DashboardPage.tsx` |
| `/add` | `web/src/pages/AddLogPage.tsx` |
| `/plan` | `web/src/pages/PlanPage.tsx` |
| `/library` | `web/src/pages/LibraryPage.tsx` |
| `/foods/new`, `/foods/edit`, `/recipes/*` | `web/src/pages/FoodPage.tsx` |
| `/family` | `web/src/pages/FamilyPage.tsx` |
| `/settings` | `web/src/pages/SettingsPage.tsx` |
| `/weight` | `web/src/pages/WeightPage.tsx` |
| `/login`, `/setup` | `web/src/pages/LoginPage.tsx`, `SetupPage.tsx` |

Shell / nav: `web/src/components/AppShell.tsx`.

## Today dashboard (UI building blocks)

| UI | Files |
| --- | --- |
| Date navigation | `web/src/components/DateBar.tsx`, `web/src/dateFormat.ts` |
| Macro pie + goal drawer | `web/src/components/MacroPieChart.tsx`, `GoalCards.tsx`, `web/src/goalCeiling.ts` |
| Meals list + log (+) | `web/src/components/DayLog.tsx` |
| Hydration stepper | `web/src/components/HydrationMeter.tsx` |
| Trends + weight sparkline | `web/src/components/TrendsPanel.tsx` |
| Family member cards | `web/src/components/FamilySummary.tsx` |

## Domain logic (server)

| Concern | Module |
| --- | --- |
| Day totals from logs | `server/src/domain/day.ts` |
| Nutrients, targets, scaling | `server/src/domain/nutrients.ts` |
| Custom meal math | `server/src/domain/compose.ts` |
| Trends series | `server/src/domain/trends.ts`, `server/src/db/trends.ts` |
| Family board (no weight) | `server/src/domain/familyView.ts` |
| Per-member insights | `server/src/domain/familyInsights.ts` |
| Weight reminders | `server/src/domain/weight.ts` |
| Diet templates | `server/src/domain/dietPresets.ts` |
| Grocery from meal plan | `server/src/domain/groceryList.ts` |
| Label / menu parsing | `server/src/domain/parseLabel.ts`, `parseMenuTable.ts`, `nutritionImport.ts` |
| Goal alerts | `server/src/domain/alerts.ts`, `server/src/db/alerts.ts`, `web/src/components/GoalAlertBanners.tsx` |
| Timezone / local dates | `server/src/domain/time.ts` |

## Data access (server `db/`)

| Table area | Module |
| --- | --- |
| Users, targets, household | `server/src/db/users.ts` |
| Foods, ingredients | `server/src/db/foods.ts` |
| Meal + hydration logs | `server/src/db/logs.ts` |
| Weight | `server/src/db/weight.ts` |
| Meal plan entries | `server/src/db/mealPlan.ts` |
| Uploads | `server/src/db/uploads.ts` |

## Tests

See [server/src/test/README.md](../server/src/test/README.md) for layout. `./deploy.sh` runs the same **`npm test`** as local dev (unless `--skip-test`).

| Kind | Location |
| --- | --- |
| HTTP integration | `server/src/test/integration/api.test.ts` |
| Test harness | `server/src/test/helpers.ts` |
| Domain unit tests | `server/src/test/unit/domain/*.test.ts` |
| Integrations unit tests | `server/src/test/unit/integrations/*.test.ts` (e.g. URL import SSRF) |
| Web | `npm run check` in `web/` (no component tests yet) |

**Runner:** `server/package.json` runs every `dist-test/**/*.test.js` after `tsc -p tsconfig.test.json`.

**Privacy regression (today):** `test/unit/domain/familyView.test.ts` + integration `api.test.ts` cookie-authenticated family JSON check (no `weight` substring). Kiosk HTTP tests planned.

## Planned work (where to edit)

| ROADMAP phase | Primary touchpoints |
| --- | --- |
| **1** Quick log | `logRoutes.ts`, `db/logs.ts`, `AddLogPage.tsx`, `test/integration/api.test.ts` |
| **3** Weight history | `weightRoutes.ts`, `db/weight.ts`, new `WeightPage.tsx`, `App.tsx`, `TrendsPanel.tsx` |
| **4a** Goal alerts | `domain/alerts.ts`, `db/alerts.ts`, `database.ts` (migration), `boardRoutes.ts`, `alertRoutes.ts`, `server.ts`, dashboard banner component |
| **5** PDF workflow | `foodRoutes.ts`, `FoodPage.tsx`, `parseLabel.ts` |
| **7** Plan extras | `mealPlanRoutes.ts`, `PlanPage.tsx`, `groceryList.ts` |

See [ROADMAP.md](./ROADMAP.md) for acceptance criteria.
