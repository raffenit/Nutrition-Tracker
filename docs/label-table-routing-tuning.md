# Label table routing: tunables and fragility watchlist

Companion to [label-table-terminology.md](./label-table-terminology.md). Documents **parameters**, **intentional tradeoffs**, and **regression risks** for variety-pack geometry and step 3 routing — not retailer-specific hacks.

## Where tunables live

| File | What it governs |
| --- | --- |
| [`labelTableLayoutParams.ts`](../Apps/Nutrition-Tracker/server/src/domain/labelTableLayoutParams.ts) | Hypothesis scores (`hypothesisScores`), subtype pick margins, `inkRailPreferScoreTieEpsilon`, `labelRailMinWidthRatio` |
| [`ruledTableGridParams.ts`](../Apps/Nutrition-Tracker/server/src/domain/ruledTableGridParams.ts) | Ruled gutters, horizontal rule levels, spurious-column trim CV, ink-bounded gutter probes |
| [`varietyPackGridPipelineParams.ts`](../Apps/Nutrition-Tracker/server/src/domain/varietyPackGridPipelineParams.ts) | Step 1 product columns, `sharedRailWidthRatioMin`, header band fractions |
| [`sharedLabelGridParams.ts`](../Apps/Nutrition-Tracker/server/src/domain/sharedLabelGridParams.ts) | Ink-profile label boundary search, value column uniformity |

Prefer changing a **named default** and adding a **synthetic regression** over inline magic in integration code.

## Fragility watchlist (monitor when touching routing)

These behaviors are **deliberate** but easy to break each other:

1. **`inkRailPreferScoreTieEpsilon`** — Ink-rail can override ambiguous subtype scores. Too loose → per-column synthetics mis-route as shared; too tight → Costco-style ink rail (value count ≫ ruled count) may not win.

2. **`perColumnUniformSharedCap`** — Caps `shared_rail` score when every ruled stack (including first) is uniform width. Uses `perColumnFirstVsOtherWidthMaxRatio`. Widening the ratio without checking wide left rails can misclassify label rails as per-column.

3. **`firstColumnWideVsSiblings` / `sharedRailWidthRatioMin`** — Shared between `isPerColumnLabelLayout`, `scoreSharedRail`, and pipeline step 3. **Keep ratios aligned** (`labelRailMinWidthRatio` in layout params should match pipeline `sharedRailWidthRatioMin`).

4. **Ink asymmetry for scoring** — `profileInkAsymmetryForLayoutScores` uses ink-profile boundary when width is in range; step 3 passes **no** asymmetry when structure is already per-column. Do not revert to “first category edge only” for `scoreLayoutHypotheses`.

5. **Ruled vertical gutter polarity** — `verticalRuledGutterBrightnessLevel` when histogram is `light_on_dark`. Ink-bounded gutter acceptance + pitch-based scan closure replace margin-specific trims. **`estimateValueColumnCountFromGutters`** uses `gutters.length` when the scan **starts inside** a bright gutter (shared-rail value origin); otherwise `gutters + 1`.

6. **`preferSharedRail` branches** — (a) subtype `shared_rail`, (b) ink value cols ≥ ruled + 2, (c) ink tie epsilon. Tests: `varietyPackGridPipeline.test.ts` step 3 routing; manifest for photos.

7. **Local manifest** — `local/test-images/manifest.json` is the main **photo** regression. Synthetics in `syntheticVarietyPackGrids.ts` cover layout **patterns**; they do not replace noisy-rule or glare variants.

## Regression tests (by concern)

| Concern | Tests |
| --- | --- |
| Ruled gutters + margin | `ruledTableGridDetect.test.ts` (glare, ink-bounded margin) |
| Subtype scoring | `labelTableLayoutFit.test.ts` (per-column vs shared pick) |
| Step 3 commit | `varietyPackGridPipeline.test.ts` (routing cases) |
| Ink asymmetry | `sharedLabelValueGrid.test.ts` (`profileInkAsymmetryForLayoutScores`) |
| Wide rail geometry | `uniformColumnGeometry.test.ts` (`firstColumnWideVsSiblings`) |
| Photos | `varietyPackGrid.manifest.localFixtures.test.ts` (when `local/test-images` present) |

When fixing a routing bug, add or extend a **pattern-level** synthetic first; touch manifest only if the failure mode is photographic (glare, skew, print noise).
