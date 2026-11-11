# Variety pack grid pipeline (geometry before OCR)

Wide Costco-style panels are parsed like a human reads them: **lines and gutters first**, text second. The server implements that as four gated steps. Each step must pass validation before the next runs (import debug log, unit tests, and `diagnose-shared-label-grid.mjs`).

## Steps

| Step | Human view | Detection | Validation |
| --- | --- | --- | --- |
| **1 — Categories** | Vertical product columns (ruled stacks) | Bright gutters + per-column horizontal rules (`categoriesFromRuledGrid`) | Enough ruled product columns; width CV under cap |
| **2 — Headers** | Product names above the ruled body | Median first horizontal rule y across product columns (`consensusBodyTopY`) | Header height fraction within min/max |
| **3 — Labels** | Shared rail vs labels in each column | Geometry rail first; else ink boundary + value grid (`sharedRailLayoutFromInkProfile`); else uniform ruled columns → `per_column_labels` | Layout class + boundary width |
| **4 — Values / rows** | Nutrient rows aligned across products | Consensus horizontal rule rows (`consensusRowBandYs`) | Minimum row band count; build `SharedLabelValueGridPlan` for OCR crops |

Step 4 does **not** run OCR. It confirms the **row mesh** exists so stitch can align label text with value columns. Full import still OCRs crops from the plan (`extractSharedLabelGridBuffers` → `stitchSharedLabelGridTexts`).

## Code map

| Piece | Path |
| --- | --- |
| Step types + validation codes | `server/src/domain/varietyPackGridPipeline.ts` |
| Fraction params | `server/src/domain/varietyPackGridPipelineParams.ts` |
| Ruled gutters / rules / row consensus | `server/src/integrations/ruledTableGridDetect.ts` |
| Gated runner | `server/src/integrations/varietyPackGridPipeline.ts` |
| OCR plan type | `server/src/integrations/sharedLabelValueGrid.ts` (`detectSharedLabelValueGrid` → pipeline) |
| Import debug lines | `server/src/integrations/extractText.ts` (`variety grid step …`) |

## Debug / test mode

**Unit tests:** `server/src/test/unit/integrations/varietyPackGridPipeline.test.ts` — runs steps 1→4 on a synthetic ruled grid; `stopAfterStep` ensures gating.

**Local image diagnose:**

```bash
cd Apps/Nutrition-Tracker/server
npm run build
node scripts/diagnose-shared-label-grid.mjs [path-to.jpg]
```

The script writes `local/diagnostics/shared-label-grid/step-N.json` for each step. If step *N* fails, it stops and does **not** run OCR for later steps. On full success it still crops PNGs and runs stitch diagnostics (same as before).

## Fraction params

Tunables live in `varietyPackGridPipelineParams.ts` and `ruledTableGridParams.ts`. See [resolution-invariant-image-pipelines.md](./resolution-invariant-image-pipelines.md).

## Related

- [CODE-MAP.md](./CODE-MAP.md) — label scan entry points
- [playbooks/label-ocr-and-parsing.md](./playbooks/label-ocr-and-parsing.md) — end-to-end import
