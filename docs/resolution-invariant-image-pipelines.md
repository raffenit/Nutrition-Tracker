# Resolution- and orientation-invariant image pipelines

Label layout detection and OCR preprocessing should behave the same whether the photo is a small thumbnail or a full-resolution camera frame. This document records **audited thresholds** and the **parameter pattern** that keeps geometry tied to image proportions.

## Rule: express image geometry as named fractions

When you tune gutters, crops, block sizes, spacing, or minimum readable dimensions:

1. **Declare a reference** (`IMAGE_ANALYSIS_WIDTH`, full-image width/height, `min(width,height)`, etc.) and store tunables as **fractions of that reference** in a `*Params.ts` module under `server/src/domain/`, with a short doc comment per field.
2. **Resample to analysis space** for structure detection where the pipeline already does so (column ink projection, laplacian focus), then **map results back** using the same ratios.
3. **Prove invariance in tests** with fractional synthetic layouts and, when you change thresholds, **0.5× / 2× scale** sweeps on the same layout.

**Fixed pixel targets belong in the doc when they are deliberate.** Examples we keep on purpose:

- **OCR engine upscale** (`OCR_TARGET_WIDTH`, 2500 / 2800) — improves engine input; separate from layout geometry.
- **Model confidence** (EasyOCR env thresholds) — model scores, not spatial layout.
- **Integral-image neighborhoods** — compute `blockSize` from `blockSizeFraction` first; index math like `x - half` then follows that scaled window.

## Principles

1. **Canonical analysis space** — Structure detection (column gutters, focus laplacian) resamples to `IMAGE_ANALYSIS_WIDTH` (640). Thresholds are fractions of that canvas or of full-image sides.
2. **Orientation** — Production paths call `sharp().rotate()` before measuring width/height. Gates use **aspect ratio** (`WIDE_PANEL_MIN_ASPECT`), not absolute width.
3. **OCR upscale is separate** — See exceptions above.
4. **Tests** — Synthetic fixtures use fractions of band width/height; multi-scale checks when touching thresholds.

## Shared geometry (`imageAnalysisGeometry.ts`)

| Export | Role |
| --- | --- |
| `IMAGE_ANALYSIS_WIDTH` | Canonical analysis canvas (640) |
| `IMAGE_MIN_SIDE_FRACTION` | Minimum readable side (80/640) |
| `IMAGE_MIN_CROP_SIDE_FRACTION` | Minimum crop extract (32/640 of side) |
| `minSideLengthPx()` / `minCropSidePx()` | Convert fractions at runtime |

## Column strip detection (`columnStripDetectParams.ts`)

| Parameter | Role | Invariant to |
| --- | --- | --- |
| `analysisWidth` | Resample band before vertical ink projection | Input megapixels / DPI |
| `bandHeightFraction` | NF table band height | Image height (post-rotate) |
| `bandTopInsetFraction` | Wide panels: **OCR crops** anchored from top; detection stays centered | Image height |
| `minGutterSpacingFraction` | Min distance between gutter minima | Analysis width |
| `gutterThresholdRatio` | Shallow gutters (low local ink vs peak) count when high | Peak ink on band |
| `gutterLocalMinimumRadiusFraction` | Wider local-min window for gutter points | Analysis width |
| `smoothRadiusFraction` | Ink profile smoothing (lighter = preserve narrow gutters) | Analysis width |
| `profileContrastSlope` / `Intercept` | Band linear contrast before projection | 0–255 |
| `minStripWidthFraction` / `minSegmentWidthFraction` | Drop noise segments | Analysis width |
| `minOutputStripWidthFraction` | Full-res strip crops | Full image width |
| `minImageWidthFraction` / `minImageHeightFraction` | “Too small to process” | `analysisWidth` |
| `WIDE_PANEL_MIN_ASPECT` (`labelLayout.ts`) | Wide variety-pack gate | Width ÷ height only |

Implementation: `server/src/integrations/labelColumnStrips.ts`.

## Ruled gutters vs glare (`bandLuminanceRoles.ts`, `ruledTableGridParams.ts`)

Gutter detection classifies band pixels into **background** and **ink** by histogram mass (works for dark-on-light and light-on-dark labels). Sparse extreme peaks are **glare**. Gutter thresholds use polarity-aware contrast, not raw max brightness.

## Uniform column geometry (`uniformColumnGeometryParams.ts`)

Variety-pack **value** columns and split-single **halves** are equal width. Refine merges with `refineUniformProductColumns`; split layout uses `detectEqualWidthColumnPair`.

## Variety pack grid pipeline (`varietyPackGridPipelineParams.ts`, `ruledTableGridParams.ts`)

Gated steps 1–4 (columns → header → label layout → row bands). See [variety-pack-grid-pipeline.md](./variety-pack-grid-pipeline.md) and [label-table-terminology.md](./label-table-terminology.md).

| Parameter | Role |
| --- | --- |
| `minHorizontalRulesPerProductColumn` | Step 1: ruled stack validation |
| `headerMinHeightFraction` / `headerMaxHeightFraction` | Step 2: product-name band |
| `sharedRailWidthRatioMin` | Step 3: left rail vs product columns |
| `minRowBands` / `rowConsensusMaxJitterFraction` | Step 4: row mesh |

## Shared label + value grid (`sharedLabelGridParams.ts`, `sharedLabelValueGrid.ts`)

| Parameter | Role |
| --- | --- |
| `labelBoundaryInkDropRatio` | Split shared row labels from numeric columns |
| `labelInkAsymmetryRatio` | Left ink plateau vs value grid |
| `minValueColumns` / `maxValueColumnWidthCv` | Reject repeated-panel false positives |

Value gutters are detected only right of the label boundary. Ruled tables: bright vertical gutters + horizontal rules per column (`ruledTableGridDetect.ts`). Stitch: `stitchSharedLabelGridTexts.ts`.

## Focus crop (`focusCropParams.ts`, `focusCrop.ts`)

| Parameter | Role |
| --- | --- |
| `minImageSideFraction` | Skip when either side too small (was `80px`) |
| `minCropSideFraction` | Floor crop width/height (was `32px`) |
| `centerBandHeightFraction` / `centerBandWidthFraction` | Center band variant |
| `laplacianBandHeightFraction` | Row score integration window |
| `laplacianBandMinHeightFraction` | Minimum window rows in analysis space |
| `laplacianVerticalMarginFraction` | Expand guided crop vertically |
| `guidedCropWidthFraction` | Horizontal crop when not preserving full width |
| `nearFullImageFraction` | Skip laplacian crop when redundant |

Test hook: `laplacianFocusRectForTest` (same resample path as production).

## Adaptive threshold (`adaptiveThresholdParams.ts`)

| Parameter | Role |
| --- | --- |
| `blockSizeFraction` | Local window diameter ÷ `min(width, height)` (tuned vs `OCR_PREPROCESS_REFERENCE_MIN_SIDE` 2200) |
| `c` | Mean offset on 0–255 scale (not DPI-related) |
| `minOddBlockSize` | Smallest allowed odd window |

## Depth-of-field focus crop (`labelFocusParams.ts`, `labelFocusHint.ts`)

| Parameter | Role |
| --- | --- |
| `FOCUS_CROP_MAX_SHARP_WIDTH_FRACTION` | Skip crop when the sharp band already spans most of the frame |
| `FOCUS_CROP_MIN_RETAINED_WIDTH_FRACTION` | Minimum retained width after crop (label silhouette) |
| `MULTI_COLUMN_FOCUS_MIN_PEAKS` | Many sharp peaks → variety table in focus → do not crop |
| `gutterProminenceFraction` / `gutterProminenceRelaxFraction` (column strips) | Prefer deep gutters; relax until at least two product strips exist |

`shouldApplyFocusCrop` combines the above — unrelated to a specific photo filename.

## Layout hints (`imageLayoutHint.ts`)

| Item | Status |
| --- | --- |
| `widePanel: aspectRatio >= WIDE_PANEL_MIN_ASPECT` | OK — orientation + ratio only |
| `width < 1 \|\| height < 1` | Degenerate guard only |

## OCR preprocess (`ocrPreprocess.ts`)

| Item | Status | Notes |
| --- | --- | --- |
| `OCR_WIDE_TABLE_TARGET_WIDTH` (2500 / 2800) | **Intentional absolute** | Engine quality target |

## When adding new image heuristics

- Add or extend a `*Params.ts` entry for every spatial threshold (prefer a fraction name such as `minGutterSpacingFraction` over an unexplained literal in integration code).
- Run structure detection on resampled analysis data when the pipeline uses a canonical analysis width.
- Pair the change with fractional fixtures and multi-scale tests under `server/src/test/unit/integrations/`.

See also [testing-standards.md](./testing-standards.md) and workspace universal-algorithms rules.
