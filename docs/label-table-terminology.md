# Nutrition label table terminology

Use **layout pattern** names in docs, tests, and comments — not retailer or store names.

## Variety pack (umbrella)

A **variety pack** is a **wide, multi-product** Nutrition Facts **table**: several products/SKUs in one photo, vertical product columns, ruled rows, gutters. Detected on **wide panels** (`WIDE_PANEL_MIN_ASPECT`) and handled by the gated pipeline `runVarietyPackGridPipeline` (steps 1–4).

Step 3 classifies **which label geometry** the pack uses:

| Layout (manifest / `VarietyPackLabelLayout`) | Name | Meaning |
| --- | --- | --- |
| `shared_rail` | **Shared-label multi-value table** | One shared nutrient-name column + N product **value** columns |
| `per_column_labels` | **Per-column labels** | Each product column includes its own label text (no shared rail) |
| `split_single` | *(not a variety pack)* | One product; single panel split into two equal halves — see below |
| `unknown` | — | Pipeline could not classify step 3 |

**“Variety pack” includes both `shared_rail` and `per_column_labels`.** Do not use “variety pack” as a synonym for only the shared rail.

Code symbols (`varietyPackGridPipeline`, `varietyPackPipeline` in manifest, etc.) refer to this **umbrella** pipeline, not one layout subtype.

## Not variety packs

| Term | Meaning | Manifest `layout` / routing |
| --- | --- | --- |
| **Split-single label** | One product, block split into two equal vertical halves | `split_single` — probed **before** variety-pack steps; `detectSplitSingleLabel` for OCR crops |
| **Single panel** | One standard Nutrition Facts block | `single` → pipeline step 1 often `band_unavailable` |

## Shared-label multi-value (subtype)

Use this phrase when you mean **`shared_rail` only**:

- One **shared label column** (nutrient names).
- Multiple **value columns** with shared horizontal rules.
- OCR/stitch path: `SharedLabelValueGridPlan`, `extractSharedLabelGridBuffers`, `stitchSharedLabelGridTexts` (step 4 plan today is built for this layout).

## Per-column labels (subtype)

Use when you mean **`per_column_labels` only**: every product column is self-contained label + values. Same variety-pack steps 1–2 and ruled column detect; step 3 returns `per_column_labels`. Import OCR: `perColumnStripPlan` → per-column strip crops → `stitchColumnStripOcrTexts` (not the shared-rail stitch).

## Layout hypothesis + column fit

Raw gutter peaks are **witnesses**, not ground truth. `labelTableLayoutFit.ts` scores layout hypotheses (`split_single`, `shared_rail`, `per_column_labels`) from focus hints, ruled grid, and dual ink projections (legacy + luminance). Tunable weights live in `labelTableLayoutParams.ts` (`hypothesisScores`, subtype pick margins). The winning layout **fits** columns to its template (equal halves, uniform value grid) instead of trusting noisy local minima alone. Import and `detectSplitSingleLabel` use this for split-single; shared-rail value boundaries use uniform snap when dense gutters disagree.

### Ruled vertical gutters

When dark cell bodies dominate the histogram, band polarity may read `light_on_dark` even on paper labels. **Vertical ruled gutters are still bright paper** — `verticalRuledGutterBrightnessLevel` in `bandLuminanceCluster.ts` supplies the bright-gap threshold for `ruledTableGridDetect.ts`. A gutter run is accepted only when **ink flanks it** on the product side (and on the left unless it is at the scan start), so open margin does not add false peaks. The value scan closes at **last gutter + median pitch**, not necessarily the full image width.

### Variety pack step 3 routing

Order of commitment:

1. Equal-width pair → `split_single`.
2. Hypothesis scores → `pickVarietyPackSubtype` (`shared_rail` vs `per_column_labels`).
3. Structural **per-column** check (`isPerColumnLabelLayout`) when subtype is `per_column_labels`.
4. **Ink-rail** shared plan when subtype is `shared_rail`, ink value count exceeds ruled count by ≥2, or shared score ties per-column within `inkRailPreferScoreTieEpsilon` (see `labelTableLayoutParams.ts`).
5. Ruled first category as label rail (width + ink asymmetry), then ink-rail fallback.

Wide left rails use `firstColumnWideVsSiblings` / `labelRailMinWidthRatio` (same idea as `sharedRailWidthRatioMin` in pipeline params). Uniform ruled stacks where the first column matches product width score as **per-column**, not shared rail.

Layout scores on step 3 use **`profileInkAsymmetryForLayoutScores`** (ink boundary when plausible), not the first ruled category width; per-column structural layouts omit asymmetry for scoring.

Tunables, intentional tradeoffs, and the fragility watchlist: **[label-table-routing-tuning.md](./label-table-routing-tuning.md)**.

## Local fixtures

Filenames under `local/test-images/` are arbitrary (`costco-candy.jpg` = shared-rail example). They are **not** product vocabulary.
