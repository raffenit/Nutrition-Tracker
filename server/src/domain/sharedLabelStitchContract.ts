/**
 * Shared-rail stitch inputs:
 *
 * - {@link labelColumnText}: full OCR of the **shared nutrient-name rail** (entire vertical
 *   crop of that strip — header/serving rows on the rail are included; width is independent of
 *   product value columns).
 * - {@link valueColumnTexts}: **product value strips only** (digits/units per SKU). The label rail
 *   must not appear here (see `sharedLabelColumnSeparation.ts` for geometry + OCR guards).
 */
export type SharedLabelStitchColumnTexts = {
  labelColumnText: string;
  valueColumnTexts: string[];
  headerBandText?: string;
};

export type SharedLabelStitchAnalyzeOptions = {
  /**
   * Index in `valueColumnTexts` that duplicates the label rail (legacy / ruled geometry).
   * Zero extracted value lines there is expected. When omitted, every entry is a product column.
   */
  labelRailValueColumnIndex?: number | null;
};
