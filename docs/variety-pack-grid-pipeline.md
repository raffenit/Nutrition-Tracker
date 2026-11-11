# Variety pack grid pipeline (geometry before OCR)

> **Terminology:** [label-table-terminology.md](./label-table-terminology.md) — a **variety pack** is multi-product wide tables; step 3 may be **shared-label multi-value** (`shared_rail`) or **per-column labels** (`per_column_labels`).

Wide **variety packs** are parsed like a human reads them: **lines and gutters first**, text second. The server implements that as four gated steps. Each step must pass validation before the next runs (import debug log, unit tests, and `diagnose-shared-label-grid.mjs`).

## Steps

| Step | Human view | Detection | Validation |
| --- | --- | --- | --- |
| **1 — Categories** | Vertical product columns (ruled stacks) | Bright gutters + per-column horizontal rules (`categoriesFromRuledGrid`) | Enough ruled product columns; **equal width** (variety grids) |
| **2 — Headers** | Product names above the ruled body | Median first horizontal rule y across product columns (`consensusBodyTopY`) | Header height fraction within min/max |
| **3 — Labels** | Variety-pack label geometry | Shared rail first; else ink boundary + value grid; else uniform ruled columns → `per_column_labels` | `shared_rail` \| `per_column_labels` \| `split_single` \| `unknown` |
| **4 — Values / rows** | Nutrient rows aligned across products | Consensus horizontal rule rows (`consensusRowBandYs`) | Minimum row band count; `SharedLabelValueGridPlan` when layout is `shared_rail` |

Step 4 does **not** run OCR. For **`shared_rail`**, it confirms the row mesh and builds the shared-label OCR plan. Full import still OCRs crops (`extractSharedLabelGridBuffers` → `stitchSharedLabelGridTexts`).

## Code map

| Piece | Path |
| --- | --- |
| Step types + validation codes | `server/src/domain/varietyPackGridPipeline.ts` |
| Fraction params | `server/src/domain/varietyPackGridPipelineParams.ts` |
| Ruled gutters / rules / row consensus | `server/src/integrations/ruledTableGridDetect.ts` |
| Gated runner | `server/src/integrations/varietyPackGridPipeline.ts` |
| Shared-rail OCR plan | `server/src/integrations/sharedLabelValueGrid.ts` (`detectSharedLabelValueGrid` → pipeline) |
| Import debug lines | `server/src/integrations/extractText.ts` (`variety grid step …`) |

## Debug / test mode

**Unit tests:** `server/src/test/unit/integrations/varietyPackGridPipeline.test.ts` — runs steps 1→4 on a synthetic ruled grid; `stopAfterStep` ensures gating.

**Ground truth:** Copy `local.example/test-images-manifest.example.json` to `local/test-images/manifest.json` and set `layout`, `valueColumnCount`, and `varietyPackPipeline` expectations per photo. `server/scripts/run-test-images-pipeline.mjs` compares actual vs manifest and exits non-zero on mismatch.

**Local image diagnose:**

```bash
cd Apps/Nutrition-Tracker/server
npm run build
node scripts/run-test-images-pipeline.mjs
node scripts/diagnose-shared-label-grid.mjs [path-to.jpg]
```

The script writes `local/diagnostics/shared-label-grid/step-N.json` for each step. If step *N* fails, it stops and does **not** run OCR for later steps. On full success it still crops PNGs and runs stitch diagnostics (same as before).

## Fraction params

Tunables live in `varietyPackGridPipelineParams.ts` and `ruledTableGridParams.ts`. See [resolution-invariant-image-pipelines.md](./resolution-invariant-image-pipelines.md).

## Related

- [CODE-MAP.md](./CODE-MAP.md) — label scan entry points
- [playbooks/label-ocr-and-parsing.md](./playbooks/label-ocr-and-parsing.md) — end-to-end import
