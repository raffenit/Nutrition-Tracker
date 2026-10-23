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
       → buildOcrImageVariants (ocrPreprocess.ts)
       → EasyOCR subset + Tesseract subset (parallel)
       → mergeSlotReadingsAcrossCandidates (labelSlotExtract.ts)
  → buildNutritionImport (nutritionImport.ts) + applySlotMergedNutrients (foodRoutes.ts)
  → JSON to FoodPage.tsx → user review
```

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

Run: repo root `npm test`.

## Rules

- Prefer **layout/universal** fixes (macro gap, units, anchors) — see repo `AGENTS.md` and workspace universal-algorithms rule.
- After new modules or moved exports, update [CODE-MAP.md](../CODE-MAP.md).
