# Playbook — label OCR and parsing

## Symptom → where to look

| Symptom | Start here | Then search for |
| --- | --- | --- |
| Missing sodium / garbled row | `server/src/domain/labelUnits.ts` | `readSodiumFromMacroGap` |
| Wrong fat/protein/fiber on one-line OCR | `server/src/domain/parseLabel.ts` | `parseNutritionLabel` |
| Best value per nutrient from many OCR strings | `server/src/domain/labelSlotExtract.ts` | `mergeSlotReadingsAcrossCandidates` |
| Fuzzy “Sedium”, “Tolal fat” anchors | `server/src/domain/labelVariants.ts` | `findVariantLabelAnchors` |
| Import too slow | `server/src/integrations/extractText.ts` | parallel EasyOCR + Tesseract; env caps below |
| EasyOCR silent / empty | `server/src/integrations/easyOcr.ts` | `runEasyOcrOnImage` (errors return null) |
| Python reader params | `server/python/easyocr_label.py` | `readtext`, env vars in module docstring |

## Pipeline (order)

```text
POST /api/uploads  (foodRoutes.ts → receiveUpload)
  → extractUploadText → extractImageLabel (extractText.ts)
       → resolveLabelProcessingImage (focus crop) / inferLabelLayoutHint
       → if widePanel: runVarietyPackGridPipeline (geometry preflight in debugLog)
       → if shared_rail plan: ocrAndStitchSharedLabelPlan → row-band or body-column OCR
       → else if column strips: ocrAndStitchColumnStrips / ocrAndStitchVarietyPack
       → else full-page: collectOcrCandidateTexts → stitch / slot merge paths
            (portrait single: 1 orientation, Tess first; if assessCoreMacroReadiness is contested →
             EasyOCR on stacked crops of only the contested rows; full-page Easy only if still unsettled / missing)
       → optional split-single, wideTableRetry
       → `GET /api/import-jobs/:id` polled while upload/URL import runs (`importJobProgress.ts`); response includes `debugLog`
       → mergeSlotReadingsAcrossCandidates (labelSlotExtract.ts)
  → buildNutritionImport (nutritionImport.ts) + applySlotMergedNutrients (foodRoutes.ts)
  → JSON to FoodPage.tsx → user review
```

On failure, `readExtractedText` logs `readExtractedText:image|pdf` to `debugLog` and stderr; hint/EasyOCR fallbacks log `inferLabelLayoutHint`, `inferDepthOfFieldHint`, `easyocr subprocess`.

## Symptom → debugLog prefix

| debugLog substring | Function / area |
| --- | --- |
| `geometry preflight:` | `runVarietyPackGridPipeline` |
| `shared-label grid` | `ocrSharedLabelGridColumns` |
| `column-strip` / `stitch` | `ocrAndStitchColumnStrips` |
| `readExtractedText:` | `foodRoutes.ts` boundary (uncaught pipeline error) |
| `inferLabelLayoutHint:` / `inferDepthOfFieldHint:` | geometry fallback (safe defaults) |
| `easyocr subprocess:` | Python EasyOCR failure |
| `ocr progressive:` / `ocr stage:` | portrait-single Easy gate (`assessCoreMacroReadiness`) / `OcrPipelineTimer` |

PDF path uses `extractPdfText` then the same import builder (no slot merge from OCR variants).

## Environment (.env)

| Variable | Effect |
| --- | --- |
| `EASYOCR_ENABLED=0` | Tesseract-only (faster CPU, weaker on hard photos) |
| `EASYOCR_MAX_VARIANTS` | Default 4 — neural OCR image count |
| `EASYOCR_AB=1` | Second EasyOCR pass (slower, sometimes better) |
| `TESSERACT_MAX_VARIANTS` | Default 12 |
| `TESSERACT_DUAL_PSM=1` | Two Tesseract page segmentation modes |

## Tests to extend

| File | Pattern to model |
| --- | --- |
| `server/src/test/unit/domain/parseLabel.test.ts` | Synthetic one-line OCR strings (layout, not brands) |
| `server/src/test/unit/domain/labelSlotExtract.test.ts` | Multi-candidate merge |
| `server/src/test/unit/integrations/easyOcr.test.ts` | Env pass configuration only |
| `server/src/test/unit/domain/labelLayout.test.ts` | Wide-table candidate pick, retry gate |

Run: repo root `npm test`.

## Reporting local OCR runs (agents + humans)

When summarizing `run-local-test-images-ocr.mjs` or manifest fixtures, use a **status column** on each row:

| Symbol | Meaning |
| --- | --- |
| **✓** | Matches manifest / goal (geometry, path, or semantic bar stated in manifest) |
| **~** | Partially OK — runnable but weak (e.g. parsed≥2 products but macros wrong, or noisy single-label) |
| **✗** | Clear fail vs manifest or goal |

Example (Costco shared_rail):

```text
| Check              | Status | Detail                          |
|--------------------|--------|---------------------------------|
| Row-band path      | ✓      | batched row-band, not body-col  |
| rowSlices vs manifest | ✓   | 15 vs 14±1                      |
| value columns      | ✓      | 10                              |
| table parse cols   | ~      | 9                               |
| macro calories     | ✗      | mostly 1–18; stitch misaligned  |
```

Do not use bare “OK/MISMATCH” without symbols when the summary is tabular.

## Rules

- Prefer **layout/universal** fixes (macro gap, units, anchors) — see repo `AGENTS.md` and workspace universal-algorithms rule.
- After new modules or moved exports, update [CODE-MAP.md](../CODE-MAP.md).
