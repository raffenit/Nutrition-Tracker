# Nutrition Tracker — roadmap

This plan closes the gaps between the client spec and the current build, in an order that delivers user-visible value early and keeps privacy/testing constraints intact.

**Navigation:** [Documentation index](./README.md) · [Code map (feature → files)](./CODE-MAP.md) · [Architecture](./ARCHITECTURE.md)

**Definition of done (global):** feature works on phone-sized UI, has server tests where behavior is non-trivial, `npm test` passes, documented in this file’s phase notes, deployable via `./deploy.sh` or `docker compose up -d --build`.

---

## Phase 0 — Documentation and baseline (current)

**Status:** Done with `docs/ARCHITECTURE.md` and this roadmap.

**Optional housekeeping**

- Keep host-specific deploy notes in gitignored `local/`.
- README links to `docs/` and `local.example/`.

---

## Phase 1 — Quick manual log (no library save)

**Status:** Done (2026-09-30).

**Problem:** Rare one-off entries still require creating a library food first.

**Goal:** Log calories/macros for “today only” without a `foods` row.

**Design**

- Extend `POST /api/logs` to accept either:
  - `{ foodId, servings, … }` (unchanged), or
  - `{ adHoc: true, name, nutrients per serving OR totals for this entry, servings, slot, eatenAt }`.
- Store `meal_logs.food_id = NULL`; keep computed nutrients on the log row (already denormalized).
- Web: on `/add`, toggle **Quick entry** — minimal form (name, servings, calories, protein, fiber, sodium + optional extras from targets).

**Acceptance**

- Ad-hoc line appears on Today and in trends/family totals like any other log.
- Library search does not list ad-hoc names unless user chooses “Save to library” (optional stretch: promote ad-hoc → food).

**Tests**

- API: create ad-hoc log, dashboard totals, delete log.
- Family board still has no weight; ad-hoc logs appear for that user only.

**Files (expected):** `logRoutes.ts`, `db/logs.ts`, `AddLogPage.tsx`, `types.ts` (server + web), `test/integration/api.test.ts`.

---

## Phase 2 — Custom meal: recipe servings in the UI

**Problem:** API supports `makesServings`; UI hardcodes `makesServings: 1` in `FoodPage.tsx` (`CustomMeal`).

**Goal:** User enters “this recipe makes N servings”; per-serving nutrients match compose math.

**Design**

- Number input **Recipe makes (servings)** with validation &gt; 0.
- Helper text: logging 1 serving = one portion of the recipe.
- When editing an existing custom food, show current `makesServings` (PATCH if not already exposed).

**Acceptance**

- Compose POST sends user’s N; saved food’s per-serving calories match sum(ingredients)/N.
- Log 2 servings → 2× per-serving on dashboard.

**Tests**

- **Done (partial):** `test/integration/api.test.ts` composes with `makesServings: 2` and checks ingredient lines on `GET /api/foods/:id`.
- **Done:** unit tests in `test/unit/domain/compose.test.ts`; API coverage in `test/integration/coverage.test.ts` (per-serving compose, log 2 servings).

**Files:** `FoodPage.tsx`, possibly `foodRoutes.ts` / PATCH body for edits.

---

## Phase 3 — Weight history view

**Status:** Done (2026-09-30) — `/weight`, API range + single delete.

**Problem:** Data and Trends sparkline exist; no dedicated place to review loss/gain over time.

**Goal:** Personal **Weight** section when check-ins are enabled.

**Design**

- Settings (or sub-route `/settings/weight`): list entries (date, weight, unit), edit/delete single entry if needed.
- Chart: 30/90 day line or bar using existing `GET /api/weight` payload (extend with range query if missing).
- Keep default **off**; copy explains family never sees this.

**Acceptance**

- Disabled weight → no nav/chart/reminder except opt-in flow in Settings.
- Enabled → history + chart; family API unchanged (run `familyView` tests).

**Tests**

- API range query; assert family board JSON has no weight keys.

**Files:** `weightRoutes.ts`, `db/weight.ts`, `SettingsPage.tsx` or new `WeightPage.tsx`, `TrendsPanel.tsx` (link “See all”).

---

## Phase 4 — Goal alerts (in-app, then optional push)

**Problem:** Client asked for goals “possibly with alert functionality”; only weekly weight reminder exists.

**Goal:** Actionable feedback when approaching or crossing daily targets.

**Phase 4a — In-app (MVP alerts)**

**Status:** Done (2026-09-30) — dashboard banners + dismiss table; Settings toggles still optional.

- On dashboard load (and after log), compute % of daily targets for calories, protein, fiber, sodium (+ extras).
- Rules (configurable later; defaults):
  - **Soft:** ≥ 90% calories or sodium → dismissible banner.
  - **Soft:** protein ≥ 100% → positive banner (optional).
  - **Hard:** calories &gt; 100% → persistent notice until next local day.
- Store dismissals per user per nutrient per local date (new small table or JSON in session — prefer table for clarity).

**Phase 4b — Push / phone pop-up (optional)**

**Status:** Done (2026-09-30) — VAPID + service worker + Settings opt-in; sends after meal log when alerts fire.

- Service worker + Web Push (VAPID keys on server) **or** document Home Assistant mobile notification automation triggered by webhook (household already uses HA).
- User opt-in in Settings; not required for client sign-off if 4a is solid.

**Acceptance**

- Alerts respect household timezone midnight reset.
- No alerts on family/kiosk views (personal dashboard only).

**Tests**

- Domain function: given totals + targets → alert list; API dashboard includes `alerts: []`.

**Files:** new `domain/alerts.ts`, `boardRoutes.ts`, dashboard components, Settings toggles, optional SW under `web/public`.

---

## Phase 5 — Restaurant PDF workflow

**Status:** Done (2026-09-30) — review UI, whitespace/table menu parse, batch placeholder API + multi-select.

**Problem:** PDF upload yields name candidates, not structured menu nutrition.

**Goal:** Faster path from restaurant sheet → library items.

**Design (incremental)**

1. **Upload review screen** — show PDF text snippet + candidate names; tap name → pre-fill new food (`kind: restaurant`, `source: pdf`).
2. **Batch stub** — multi-select candidates → create placeholder foods (name only, zero nutrients) for later edit (optional).
3. **Smarter parse (stretch)** — detect table rows with calorie integers per line; map to `menuCandidates` + numeric extraction heuristics; always user-confirms.

**Acceptance**

- User can go PDF → pick “Grilled salmon” → nutrition form in ≤3 taps.
- No regression on label photo path.

**Tests**

- Extend `parseLabel.test.ts` / fixture PDFs for row parsing when added.

**Files:** `foodRoutes.ts` (upload response already has candidates), `FoodPage.tsx` / new `PdfReview` flow, `parseLabel.ts`.

---

## Phase 6 — Walk reminder (bonus, out of band)

**Problem:** Client listed optional walk pop-up unrelated to nutrition.

**Recommendation:** Do **not** embed in core app unless requested again.

**Options doc (implement one)**

| Approach | Pros | Cons |
| --- | --- | --- |
| HA automation + mobile app | No app changes; household already on HA | Requires HA setup |
| PWA scheduled notification | Self-contained | OS support varies; needs SW + permission |
| n8n / cron + Tailscale webhook | Flexible | Extra service |

Deliverable: short `docs/WALK-REMINDER.md` with HA example automation (time + notify service) if client wants it.

---

## Phase 7 — OpenCookbook v1 (meal plan + grocery)

**Status:** In progress (Plan tab, household week, Markdown export).

**Goal:** Plan → shop → log loop without third-party grocery APIs.

**Shipped / in tree**

- Household **meal plan** (Mon–Sun) with recipes from Library.
- **Aggregated grocery list** (Instacart-shaped `lineItems`: name, quantity, unit).
- **Shopping list UI** with checkboxes + **Copy Markdown**.
- **Log from plan** → Today for that day.

**Next**

- Plan packaged foods / single ingredients, not only recipes.
- Pantry (“already have”) toggles on grocery lines.
- Optional Instacart IDP export when/if partner access is available.

---

## Phase 10 — Meal-kit recipe cards (import + follow-ups)

**Status:** In progress — scanned PDF OCR, `recipeCard` upload payload, `instructions` on custom recipes, recipe editor PDF import (see `parseRecipeCard.ts`, `ocrScannedPdf.ts`).

**Goal:** One library **recipe** holds **shopping ingredient lines**, **cooking instructions**, and **per-serving nutrition** (meal-kit cards such as Green Chef), integrated with Plan → grocery and logging.

**Foundation (in tree / landing)**

- PDF with no text layer → page rasterize (`poppler`) + existing OCR pipeline.
- Section parser: Ingredients / Instructions / Nutrition (layout patterns, not brand-specific).
- Compose saves text ingredient lines; nutrition from label panel when lines are not linked to library foods.
- Grocery aggregation already uses recipe ingredient **names** for shop lists.

**Next (nice-to-have backlog)**

- [ ] **Cooking mode on Plan** — show saved `instructions` on the meal plan (and/or a read-only “while cooking” view tuned for phone).
- [ ] **Richer grocery lines** — parse quantity and unit from ingredient text (e.g. `12 oz chicken`) so shop list shows structured qty/unit instead of only “1 serving” per line.
- [ ] **Photo import** — apply the same `parseRecipeCard` flow to **image** uploads (recipe card photos), not only PDF.
- [ ] **Link ingredients after import** — UI to attach imported lines to library foods when desired (macro rollup from components vs label nutrition).

**Tests**

- Unit: `parseRecipeCard.test.ts` (+ OCR/layout fixtures as patterns, not proprietary copy).
- Integration: compose with text-only ingredients + label nutrients; grocery list names from imported lines.

**Files (expected):** `parseRecipeCard.ts`, `nutritionImport.ts`, `ocrScannedPdf.ts`, `foodRoutes.ts`, `FoodPage.tsx` (`RecipeEditor`), `PlanPage.tsx` (instructions display), `groceryList.ts` (qty/unit), `Dockerfile` (`poppler-utils`).

---

## Phase 8 — Polish and client handoff

- **Barcode scan:** native camera barcode → Open Food Facts lookup (stretch; not in original MVP table).
- **README client section:** link spec → feature matrix (arch doc table).
- **Performance:** OCR uploads async feedback (progress UI) if large PDFs feel slow.
- **Backup / persistence:** moved to **Phase 11** (production incident — empty household after Docker restart).

---

## Phase 11 — Data persistence, backup, and recovery (priority)

**Status:** Done (2026-11-11) — marker, health stats, deploy guard, startup refusal logs, WAL checkpoint (shutdown + periodic + startup), in-app scheduled backups, `scripts/backup-data.sh`, [data-backup-recovery playbook](./playbooks/data-backup-recovery.md).

**Problem:** Households must not lose users, foods, logs, or uploads across **container restart**, **host reboot**, or **`git pull` + `./deploy.sh`** rebuild. A friend’s install appeared wiped after Docker recovered.

**Current design (verify on every deployment)**

- `docker-compose.yml` bind-mounts host `./data` → container `/data`; `DATA_DIR=/data`; SQLite at `nutrition.sqlite` (WAL mode).
- Deploy runs `compose up -d --build` only — **not** `down -v` (named volumes in `docker-compose.standalone.yml` are for **Caddy** only, not the app DB).
- Empty DB → `GET /api/health` returns `setupRequired: true` (`countUsers === 0`).

**Investigation checklist (ops + code)**

- [ ] On affected host: does `data/nutrition.sqlite` still exist and have non-zero size? WAL/SHM siblings present?
- [ ] Was the stack started from a **different working directory** (second empty `./data`) or a fresh clone without copying `data/`?
- [ ] Confirm compose actually mounts `./data:/data` (`docker inspect nutrition-tracker` → `Mounts`).
- [ ] Rule out `docker compose down` from wrong path, manual image runs without `-v`, or `DATA_DIR` override pointing inside ephemeral container FS.
- [ ] SQLite integrity after hard kill: `PRAGMA integrity_check`; WAL recovery docs if `-wal` was orphaned.

**Goal — robust persistence**

1. **Document** Frankenstein + standalone deploy: “data lives only in host `data/`”; never delete; backup before migrate experiments.
2. **Pre/post deploy guard:** script step or health metadata (e.g. `userCount`, `foodCount`, `dataDir`, db file mtime) — **fail deploy** if counts drop to zero unexpectedly (opt-out flag for intentional fresh install).
3. **Automated backup:** **done in-app** — `DATA_AUTO_BACKUP_HOURS` (default 24) → `data/backups/` via `server/src/db/backup.ts`; host `scripts/backup-data.sh` for manual copies; copy backups off-disk still recommended.
4. **Recovery playbook:** restore from backup; verify login + library; when to merge vs replace DB.
5. **Optional:** admin “export household” / import for user-held backup (stretch).

**Acceptance**

- Documented procedure: restart container → same users and library as before.
- Documented procedure: `git pull` + `./deploy.sh --skip-git` → same data.
- Backup restore tested once on dev/staging mount.
- README + `docs/playbooks/server-deploy-frankenstein.md` link recovery steps.

**Tests**

- Integration: `createTestServer` uses temp dir — add deploy-script **smoke** or documented manual checklist (not necessarily CI).
- Optional: unit test helper that asserts `openDatabase` does not recreate file when path exists and has rows.

**Files (expected):** `deploy.sh` / `scripts/deploy-lib.sh`, `docs/playbooks/data-backup-recovery.md` (new), `authRoutes.ts` or new `opsRoutes.ts` for richer health, README deploy section.

---

## Phase 12 — Multi-label photos and PDFs

**Status:** In progress (2026-11-11) — text split on repeated Nutrition Facts headings; pick-one or import-all UI on Add food. Per-page PDF raster split still TODO; Settings default preference TODO.

**Problem:** One camera shot or PDF page may contain **several** separate nutrition labels. Today the pipeline assumes a single label (or PDF menu name list), not multiple label regions.

**Goal:** Detect multiple label regions, then let the user choose import strategy **before** parsing.

**Design**

1. **Detection (server):** layout/OCR pass that returns **N label candidates** (bounding regions or text blocks each passing `looksLikeLabel` heuristics) — universal patterns, not brand-specific.
2. **Pre-import UI (web):** after upload, if `N > 1`:
   - **Pick one** — same flow as today (field review → save one food).
   - **Import all** — run parse + review queue per label; create **N library foods** (names from each panel).
   - Remember choice as default in Settings (per household).
3. **PDFs:** same fork for multi-label **scanned PDF pages** (rasterize page → multi-region) **and** extend existing **menu PDF** multi-select (Phase 5) so “import all selected as foods” is consistent for menu rows and multi-label pages.
4. **Recipe cards (Phase 10):** keep recipe-card path separate; multi-label setting applies to **standard nutrition label** import and restaurant/menu PDF workflows.

**Acceptance**

- Multi-label fixture images in `test-images/` produce ≥2 candidates in dev.
- User can import one or all without re-uploading.
- Single-label uploads unchanged (no extra step when `N === 1`).

**Tests**

- Unit: synthetic multi-block OCR text fixtures (pattern-based, not proprietary labels).
- Optional: integration upload with committed downscaled fixtures.

**Files (expected):** `integrations/focusCrop.ts` or new `labelRegions.ts`, `nutritionImport.ts`, `foodRoutes.ts`, `FoodPage.tsx`, `parseLabel.ts`, `ocrScannedPdf.ts`, `CODE-MAP.md`.

---

## Phase 13 — Tags (foods and ingredients)

**Status:** Not started.

**Problem:** Library search is name-oriented; no overlapping organization (folders don’t allow multiple categories). “Counts as a drink” is a separate boolean.

**Goal:** **Many-to-many tags** on **foods** and on **ingredient lines** (custom recipes), searchable and filterable in Library and compose pickers.

**Design**

- Schema: `tags` (id, name, slug) + `food_tags` (+ optionally `food_ingredient_tags` or tag ingredient lines via parent recipe).
- UI: tag chips on food editor; typeahead create; Library filter by tag (multi-select AND).
- Search: `GET /api/foods?q=&tags=drink,snack` (exact API TBD).
- **Drinks integration:** keep `is_drink` + `drink_ml` for **hydration math** (logging, plan, dashboard). Optionally:
  - Auto-apply tag `drink` when “Counts as a drink” is enabled, and/or
  - Migrate optional: suggest drink tag when toggling hydration.
  - User-defined tags: `breakfast`, `snack`, `meal-prep`, etc. — independent of log **slot** where useful.

**Acceptance**

- Food can have multiple tags; filter shows union of selected tags.
- Ingredient tagging (at minimum: tags on parent recipe’s text ingredients or link tags on linked child foods — pick one model in implementation).
- Drink logging still uses `is_drink` / volume; tag `drink` is discoverability, not sole source of truth.

**Tests**

- API: create food with tags, list filter, update tags, privacy unchanged on family APIs.

**Files (expected):** `database.ts` migrations, `db/foods.ts`, `foodRoutes.ts`, `FoodPage.tsx`, library search components, `types.ts` (server + web).

---

## Phase 9 — Offline PWA + sync (full implementation)

**Status:** Done (2026-09-30) — shell cache, pins, outbox (meals/hydration/delete), Background Sync hook, library/dashboard cache.

**Problem:** The app is installable (manifest + Add to Home Screen) but every screen calls the API. Without Tailscale or server reachability, the installed icon opens to errors — no logging, no cached library, no sync when connectivity returns.

**Goal:** After at least one successful online session, the household can **use core nutrition workflows offline** on phone/tablet and **reconcile automatically** when the server is reachable again — without duplicate logs or silent data loss.

**Non-goals (stay online-only until a later phase)**

- Label/PDF upload, OCR, URL import, remote ingredient search (USDA / Open Food Facts).
- Live family/kiosk board updates (kiosk remains online-first; optional read-only stale snapshot is stretch).
- Push subscription or delivery while offline (queue notifications only after sync if needed).

### 9a — App shell + read cache

- Extend the service worker beyond push: cache **built assets** (JS/CSS/icons) and **app shell** so `/` and client routes load offline.
- **IndexedDB** (or equivalent) stores last-known:
  - Session capability flag (“can work offline until …”) after online login.
  - User targets, unit prefs, enabled extras.
  - Food library **subset**: favorites + recently logged + explicit “keep offline” pin (Settings).
  - **Today snapshot**: dashboard totals, meal lines, hydration, in-app alerts (read-only stale).
- UI: **Offline** banner; “Last updated …”; disable actions that require network with clear copy.

**Acceptance**

- Airplane mode after a normal online day → Today and Library (cached) render; no blank white screen.

### 9b — Write outbox + idempotent server apply

- Local **outbox** of mutations with stable **client-generated ids** (`clientMutationId` UUID per operation):
  - Create log (library food or ad-hoc quick entry), delete log, add/remove water.
  - Optional in same phase: weight entry create/delete (personal only).
- `POST /api/logs` (and related routes) accept optional `clientMutationId`; server stores uniqueness per user and returns existing row on replay (no double-count on dashboard/family).
- Sync runner: on `online` event, periodic retry, and **Background Sync** registration where the browser supports it; exponential backoff; surface **N pending** in header or Settings.
- Ordering: apply outbox in **created-at order**; failed row stays queued with error message (e.g. deleted food) — user can fix or discard.

**Acceptance**

- Log lunch offline → reconnect → one entry on server, trends/family totals correct.
- Kill app mid-sync → resume without duplicates.

**Tests**

- Server: same `clientMutationId` twice → single log row; dashboard totals once.
- Server: outbox order with two logs same day.
- Client: pure functions for merge/outbox state (no browser in unit tests where possible).

### 9c — Offline UX parity (logging flows)

- **`/add`**: library picker from cache; quick entry fully offline; servings/slot/date default to local “today” in household TZ (cached `TZ` or user-visible warning if TZ unknown).
- **Dashboard**: show pending outbox lines as “Syncing…” or dashed until confirmed; allow delete of pending before sync.
- **Settings**: “Offline library” — pin foods, show cache size, “Clear offline data” (outbox + cache, not server).
- **Plan tab:** unify grocery checkmarks (today `localStorage`) with IndexedDB if needed so one offline store owns client state.

**Acceptance**

- Core loop offline: open app → quick log or cached food log → see provisional Today → sync → matches server after refresh online.

### 9d — Conflicts, security, and ops

- **Conflicts:** if server row changed while offline (rare for personal logs), default **server wins** for synced ids; outbox create always inserts new server ids. Document in ARCHITECTURE.
- **Auth:** cookie session still required; offline only after online login in that browser profile. Kiosk tokens not cached for write offline.
- **HTTPS / install:** offline does not remove need for secure context for push; independent features.
- **Deploy:** bump SW cache version on each release; README note on “open app once online after upgrade.”

**Acceptance**

- Privacy checklist unchanged: weight never on family API; offline cache never exposes other users’ data on shared devices without their session.

**Files (expected)**

- `web/public/sw.js` (or Workbox build step), new `web/src/offline/` (db, sync, hooks, types).
- `web/src/api/client.ts` — online detection + outbox wrapper.
- `server/src/routes/logRoutes.ts`, `db/logs.ts`, migration for `client_mutation_id` (or dedicated `sync_mutations` table).
- `waterRoutes` / `db/water` if water in scope (recommended).
- `docs/ARCHITECTURE.md` — offline/sync section when shipped.
- `docs/CODE-MAP.md` — offline module row.

**Suggested build order**

```text
9a read cache + shell  →  9b outbox + idempotency  →  9c UX  →  9d conflicts/docs
```

---

## Suggested timeline (engineering order)

```text
Phase 1 Quick log          ──► immediate UX win, small API change
Phase 2 Custom servings UI ──► tiny, fixes spec mismatch
Phase 3 Weight view        ──► completes weight story
Phase 4a Goal alerts       ──► client “alert functionality” (in-app)
Phase 5 PDF workflow       ──► larger UX, iterative
Phase 4b Push (optional)   ──► after 4a rules stable
Phase 6 Walk doc/automation► only if client confirms
Phase 7 OpenCookbook next   ► plan/grocery (in progress)
Phase 10 Meal-kit recipes   ► PDF/photo import; Plan cooking UX; grocery qty parse
Phase 11 Data + backup      ► **priority** — verify mounts, backups, recovery (production data loss)
Phase 12 Multi-label import ► photos + PDFs; pick-one vs import-all
Phase 13 Tags               ► library search; optional link to drink tag
Phase 8 Polish              ► parallel / handoff
Phase 9 Offline PWA + sync  ► after core online flows stable (1–4, logging API)
```

---

## Tracking

Use GitHub issues or checkboxes in PR descriptions keyed by phase number. When a phase ships, update the status column in `ARCHITECTURE.md` spec table and mark the phase **Done** here with date.

**Privacy checklist before every PR touching logs or board APIs**

- [ ] `assertFamilyBoardIsPublic` still passes
- [ ] No weight fields in `/api/family` or kiosk session responses
- [ ] New personal features gated by user session, not kiosk token
