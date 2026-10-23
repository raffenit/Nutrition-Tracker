# Code map — feature → files

Find code by **feature or export name**, not line numbers. See [playbooks/](./playbooks/README.md) for task walkthroughs and `.devin/rules/navigation.md` in the workspace for navigation rules.

Types are mirrored in `server/src/types.ts` and `web/src/types.ts` unless noted.

## Entry points

| What | Path | Start here |
| --- | --- | --- |
| HTTP server bootstrap | `server/src/index.ts`, `server/src/server.ts` | `server.ts` |
| Route registration | `server/src/server.ts` | `foodRoutes`, `boardRoutes`, … |
| Router | `server/src/http/router.ts` | `route()`, `match()` |
| Auth + JSON handler | `server/src/http/handle.ts` | `handleRequest` |
| SQLite schema + migrations | `server/src/db/database.ts` | `migrate()` |
| SPA route → page | `web/src/App.tsx` | path → component map |
| API client (cookies) | `web/src/api/client.ts` | `api()` |
| Upload progress XHR | `web/src/api/uploadWithProgress.ts` | `apiFormUpload` |
| Windows batch → WSL deploy | `deploy-from-windows.bat` → `deploy.sh` | WSL: auto `scripts/wsl-preflight.sh` in `deploy.sh` |
| Windows/WSL ops doc | `docs/WINDOWS-TROUBLESHOOTING.md`, `docs/SETUP-WINDOWS-WSL.md` | — |
| Offline cache + sync outbox | `web/src/offline/` | `sync.ts`, `mutations.ts` |
| Service worker (shell + push) | `web/public/sw.js` | — |
| Global styles | `web/src/styles.css` | `.import-progress*` for import UI |

## Label scan, OCR, and parsing

End-to-end: **`POST /api/uploads`** → OCR candidates → slot merge → **`buildNutritionImport`** → client review.

| Concern | Module | Key exports / symbols |
| --- | --- | --- |
| Upload + merge into draft | `server/src/routes/foodRoutes.ts` | `receiveUpload`, `applySlotMergedNutrients`, `extractUploadText` |
| OCR orchestration | `server/src/integrations/extractText.ts` | `extractImageLabel`, `extractPdfText`, `collectOcrCandidateTexts` |
| Image preprocess (Sharp) | `server/src/integrations/ocrPreprocess.ts` | `buildOcrImageVariants`, `easyOcrVariantSubset`, `tesseractVariantSubset` |
| Focus / threshold variants | `server/src/integrations/focusCrop.ts`, `adaptiveThreshold.ts` | `focusCropVariants`, `adaptiveThresholdVariants` |
| EasyOCR (Python) | `server/src/integrations/easyOcr.ts`, `server/python/easyocr_label.py` | `extractEasyOcrTextsFromVariants`, `easyOcrPassEnvironments` |
| Label vs menu detection | `server/src/domain/nutritionImport.ts` | `buildNutritionImport` |
| Full label parse (text → nutrients) | `server/src/domain/parseLabel.ts` | `parseNutritionLabel`, `readSodiumMgNoisy` |
| Per-slot merge across OCR strings | `server/src/domain/labelSlotExtract.ts` | `mergeSlotReadingsAcrossCandidates`, `extractSlotReadingsFromText` |
| Units, macro-gap sodium | `server/src/domain/labelUnits.ts` | `readSodiumFromMacroGap`, `readNutrientAmountInSlice`, `assignByVariantLabelWindow` |
| Fuzzy row names (Sedium, Tolal fat) | `server/src/domain/labelVariants.ts` | `findVariantLabelAnchors`, `matchVariantLabelToken` |
| OCR character normalization | `server/src/domain/ocrConfusables.ts` | confusable maps used by parsers |
| Anchor windows for rows | `server/src/domain/labelBoundaries.ts` | `sliceForLabelAnchor`, `LABEL_SLOT_ORDER` |
| Serving header OCR | `server/src/domain/labelHeaderParse.ts` | `parseServingsPerContainerVariant`, header matchers |
| Import field confidence (UI) | `server/src/domain/labelFieldReview.ts` | review map for draft fields |
| Candidate scoring | `server/src/domain/labelSlots.ts`, `labelSlotExtract.ts` | `scoreLabelExtraction`; `primaryCandidateIndex` |
| URL / PDF text import | `server/src/integrations/importUrl.ts`, `htmlText.ts` | `importNutritionFromUrl` |
| Menu tables (non-label HTML) | `server/src/domain/parseMenuTable.ts`, `menuTableSchema.ts` | table-driven columns |

**Env (runtime):** `.env.example` — `EASYOCR_ENABLED`, `EASYOCR_MAX_VARIANTS`, `EASYOCR_AB`, `TESSERACT_MAX_VARIANTS`, `TESSERACT_DUAL_PSM`.

**Playbook:** [playbooks/label-ocr-and-parsing.md](./playbooks/label-ocr-and-parsing.md)

## Food import UI (web)

| Concern | Module | Key symbols |
| --- | --- | --- |
| Label / PDF / URL import page | `web/src/pages/FoodPage.tsx` | `FoodEditor`, `uploadFile`, `startProcessMessages` |
| Drop zone, camera, URL field | `web/src/components/FoodImportPanel.tsx` | `FoodImportPanel` |
| Progress bar + steps | `web/src/components/ImportProgress.tsx` | `ImportProgress`, `ImportProgressState` |
| Step copy (image/PDF/URL) | `web/src/lib/importProcessingSteps.ts` | `IMAGE_IMPORT_STEPS`, … |
| Field-level review flags | `web/src/importFieldReview.ts` | maps server review → form |
| Capture hints | `web/src/components/LabelCaptureHints.tsx` | partial import messaging |

**Playbook:** [playbooks/food-import-ui.md](./playbooks/food-import-ui.md)

## Routes (server)

| Prefix / area | File | Notable handlers |
| --- | --- | --- |
| Setup, login, targets, diet presets | `server/src/routes/authRoutes.ts` | login, targets |
| Dashboard, family board | `server/src/routes/boardRoutes.ts` | dashboard, family |
| Foods, uploads, compose, search | `server/src/routes/foodRoutes.ts` | `receiveUpload`, `importFromUrl` |
| Meal + hydration logs | `server/src/routes/logRoutes.ts` | ad-hoc logs |
| Weight prefs + entries | `server/src/routes/weightRoutes.ts`, `weightStatus.ts` | — |
| Meal plan (OpenCookbook) | `server/src/routes/mealPlanRoutes.ts` | — |
| Goal alert dismiss | `server/src/routes/alertRoutes.ts` | — |

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
| Goal alerts | `server/src/domain/alerts.ts`, `server/src/db/alerts.ts`, `web/src/components/GoalAlertBanners.tsx` |
| Timezone / local dates | `server/src/domain/time.ts` |

**Playbook:** [playbooks/family-privacy.md](./playbooks/family-privacy.md)

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

See [server/src/test/README.md](../server/src/test/README.md). `./deploy.sh` runs **`npm test`** unless `--skip-test`.

| Kind | Location | Search for |
| --- | --- | --- |
| HTTP integration | `server/src/test/integration/` | `api.test.ts`, `coverage.test.ts` |
| Test harness | `server/src/test/helpers.ts` | `createTestServer` |
| Label / parse unit | `server/src/test/unit/domain/parseLabel.test.ts` | `parseNutritionLabel`, sodium gap |
| Slot merge unit | `server/src/test/unit/domain/labelSlotExtract.test.ts` | `mergeSlotReadingsAcrossCandidates` |
| EasyOCR env unit | `server/src/test/unit/integrations/easyOcr.test.ts` | `easyOcrPassEnvironments` |
| Family privacy unit | `server/src/test/unit/domain/familyView.test.ts` | `assertFamilyBoardIsPublic` |
| Web | `web/` | `npm run check` (no component tests yet) |

**Runner:** `server/package.json` → all `dist-test/**/*.test.js` after `tsc -p tsconfig.test.json`.

## Planned work (where to edit)

| ROADMAP phase | Primary touchpoints |
| --- | --- |
| **1** Quick log | `logRoutes.ts`, `db/logs.ts`, `AddLogPage.tsx`, `test/integration/api.test.ts` |
| **3** Weight history | `weightRoutes.ts`, `db/weight.ts`, `WeightPage.tsx`, `App.tsx`, `TrendsPanel.tsx` |
| **4a** Goal alerts | `domain/alerts.ts`, `db/alerts.ts`, `database.ts`, `boardRoutes.ts`, `alertRoutes.ts` |
| **5** PDF workflow | `foodRoutes.ts`, `FoodPage.tsx`, `parseLabel.ts`, `nutritionImport.ts` |
| **7** Plan extras | `mealPlanRoutes.ts`, `PlanPage.tsx`, `groceryList.ts` |

See [ROADMAP.md](./ROADMAP.md) for acceptance criteria.

## Maintenance

When you add or move a **domain**, **integration**, or **import/OCR** module, add a row here (and a one-line update in [ARCHITECTURE.md](./ARCHITECTURE.md) if behavior is user-visible). Do **not** store line numbers in this file.
