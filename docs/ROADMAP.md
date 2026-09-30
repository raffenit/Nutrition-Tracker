# Nutrition Tracker — roadmap

This plan closes the gaps between the client spec and the current build, in an order that delivers user-visible value early and keeps privacy/testing constraints intact.

**Definition of done (global):** feature works on phone-sized UI, has server tests where behavior is non-trivial, `npm test` passes, documented in this file’s phase notes, deployable via `./deploy.sh` or `docker compose up -d --build`.

---

## Phase 0 — Documentation and baseline (current)

**Status:** Done with `docs/ARCHITECTURE.md` and this roadmap.

**Optional housekeeping**

- Keep host-specific deploy notes in gitignored `local/`.
- README links to `docs/` and `local.example/`.

---

## Phase 1 — Quick manual log (no library save)

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

**Files (expected):** `logRoutes.ts`, `db/logs.ts`, `AddLogPage.tsx`, `types.ts` (server + web), `api.test.ts`.

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

- Unit test already in compose; add API test composing with N&gt;1 and logging.

**Files:** `FoodPage.tsx`, possibly `foodRoutes.ts` / PATCH body for edits.

---

## Phase 3 — Weight history view

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

- On dashboard load (and after log), compute % of daily targets for calories, protein, fiber, sodium (+ extras).
- Rules (configurable later; defaults):
  - **Soft:** ≥ 90% calories or sodium → dismissible banner.
  - **Soft:** protein ≥ 100% → positive banner (optional).
  - **Hard:** calories &gt; 100% → persistent notice until next local day.
- Store dismissals per user per nutrient per local date (new small table or JSON in session — prefer table for clarity).

**Phase 4b — Push / phone pop-up (optional)**

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

## Phase 7 — Polish and client handoff

- **Barcode scan:** native camera barcode → Open Food Facts lookup (stretch; not in original MVP table).
- **README client section:** link spec → feature matrix (arch doc table).
- **Backup runbook:** copy `data/` volume; SQLite WAL checkpoint note.
- **Performance:** OCR uploads async feedback (progress UI) if large PDFs feel slow.

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
```

---

## Tracking

Use GitHub issues or checkboxes in PR descriptions keyed by phase number. When a phase ships, update the status column in `ARCHITECTURE.md` spec table and mark the phase **Done** here with date.

**Privacy checklist before every PR touching logs or board APIs**

- [ ] `assertFamilyBoardIsPublic` still passes
- [ ] No weight fields in `/api/family` or kiosk session responses
- [ ] New personal features gated by user session, not kiosk token
