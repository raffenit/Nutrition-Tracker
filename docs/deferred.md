# Deferred work

## Unified layout shape gates (split-single + shared-rail + portrait)

**Status:** Deferred (not worth doing now).

**Context:** Portrait page OCR uses `resolveLabelOcrSources` + `assessNutritionFactsLabelShape` on ink-envelope crops (`panelShapeGate` in manifest). Split-single uses band analysis + layout hypotheses + text stitch gate; shared-rail uses variety-pack steps 1–4 (`stepValidation` codes), not single-panel shape.

**If we revisit:** Add `assessLabelRegionShape({ role })` facade with modes `page_panel | wide_band | split_half | value_column`; keep variety steps and `detectSplitSingleLabel` — unify **reporting/manifest**, not replace step logic. Estimate ~2–4 days for facade + split band check; week+ to collapse variety steps (high Costco risk).

**Entry points:** `labelOcrSources.ts`, `portraitLabelPanelCrop.ts`, `varietyPackGridPipeline.ts`, `splitSingleLabel.ts`, manifest `panelShapeGate` / future `layoutShapeGate`.