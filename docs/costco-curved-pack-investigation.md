# Curved shared-rail packs (Costco candy exemplar)

**Fixture:** `local/test-images/costco-candy.jpg` (gitignored on most machines; see `local.example/`).

**Verdict:** Geometry/viz for outer columns improved in Nov 2026; **macro import on this photo is not usable** until label OCR + calories-row stitching are fixed. Do not trust `macroImportBlocker: null` on this fixture alone.

## Workflow

1. `npm run build` in `server/`
2. `node scripts/visualize-shared-label-row-regions.mjs ../local/test-images/costco-candy.jpg`
3. Read **`shapes-preview.jpg`** (not only JSON) — cols 8–10, protein → footer
4. Optional: `visualize-shared-label-row-band-ocr-crops.mjs` (OCR-identical crops)
5. Fresh OCR check: `capture-shared-label-ocr-fixture.mjs` then inspect stitch calories row

## Geometry lessons (outer cols 7–9 on label = indices 6–8)

| Issue | Fix / param |
|--------|----------------|
| Skew capped ~7px | `rowSurfaceSkewOuterColumnMaxPitchFraction` (1.35), `outerColumnRowSurfaceSkewCapPx` |
| Tail flatten to consensus | Skip `alignWarpedNutrientTailToConsensus` when `usedSkewedInk` + fan |
| Hairline repair resets warp | `repairHairlineNutrientBands(..., preserveInkWarp)` |
| Anchor mesh only on last col | `anchorInkMeshToColumnRules = preferDownwardFan` |
| Wrong outer trio | `preferDownwardFan`: `colIndex >= columnCount - 4 && colIndex < columnCount - 1` |
| Integer Sharp crops | Round regions in `extractSharedLabelGridBuffers` |

## OCR / import lessons (Costco-specific)

- Row-band geometry **did not** change stitch output materially vs pre-warp snapshot (still `19 9%`, `4g 5%` in calories row).
- Label rail OCR garbage → wrong row alignment in stitch.
- `countSharedLabelCalorieColumns` treats small positives (19, 4) as success — **false green**.
- `assessSharedLabelRowBandOcrRetry` is more honest (`no_macro_columns`, 3 plausible calorie cells).

## Tests (2026-11-14)

- Shared-label domain units: **66/66** pass
- `npm run test:quick`: **303 pass / 12 fail** — all failures are **synthetic shared-label / variety-pack** integration tests, not Costco photo tests
- Costco snapshot unit tests pass (stage gate only; see false green above)

## Related

- [variety-pack-grid-pipeline.md](./variety-pack-grid-pipeline.md) — row viz
- [playbooks/label-ocr-and-parsing.md](./playbooks/label-ocr-and-parsing.md) — import flow
- Machine-local detail log: `local/diagnostics/row-regions/INVESTIGATION-costco-candy.md` (under gitignored `local/`)