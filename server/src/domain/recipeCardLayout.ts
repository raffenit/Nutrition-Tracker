/**
 * Geometry-based reconstruction of a recipe-card front page from OCR word boxes.
 *
 * Meal-kit cards print ingredients as a table: one quantity column per serving
 * size ("2 SERVINGS | 4 SERVINGS"), then an INGREDIENTS name column, often with
 * another list ("What you'll need") to the right. Tesseract's text output
 * interleaves or separates those columns unpredictably, so we rebuild rows from
 * word positions instead: anchor on the INGREDIENTS header, derive column
 * x-ranges from the header row, then group words below into visual rows.
 */

export type OcrWordBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type RecipeIngredientRow = {
  /** One quantity per serving column (empty string when unread). */
  quantities: string[];
  name: string;
};

export type RecipePageLayout = {
  /** Largest-type heading on the page (the recipe title on meal-kit cards). */
  title: string | null;
  /** Serving counts from the table header, e.g. [2, 4]. */
  servings: number[];
  ingredients: RecipeIngredientRow[];
};

const INGREDIENTS_HEADER = /^ingredients?:?$/i;
const SERVINGS_WORD = /^servings?$/i;

type Row = { yCenter: number; words: OcrWordBox[] };

function yCenter(word: OcrWordBox): number {
  return (word.bbox.y0 + word.bbox.y1) / 2;
}

function height(word: OcrWordBox): number {
  return word.bbox.y1 - word.bbox.y0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Group words into visual rows by vertical center (words sorted top-to-bottom). */
function groupRows(words: OcrWordBox[], tolerance: number): Row[] {
  const rows: Row[] = [];
  for (const word of [...words].sort((a, b) => yCenter(a) - yCenter(b))) {
    const center = yCenter(word);
    const row = rows.find((candidate) => Math.abs(candidate.yCenter - center) <= tolerance);
    if (row) {
      row.words.push(word);
      row.yCenter = median(row.words.map(yCenter));
    } else {
      rows.push({ yCenter: center, words: [word] });
    }
  }
  for (const row of rows) row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return rows.sort((a, b) => a.yCenter - b.yCenter);
}

function rowText(words: OcrWordBox[]): string {
  return words.map((word) => word.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Trailing 1–2 character token after a name is an allergen icon read as text ("Feta cheese m"). */
function stripAllergenMarker(name: string): string {
  const tokens = name.split(' ');
  if (tokens.length >= 2 && /^[('"“‘]?[A-Za-z0-9]{1,2}[)'"”’]?$/.test(tokens[tokens.length - 1]!) && tokens[tokens.length - 2] !== '&') {
    return tokens.slice(0, -1).join(' ');
  }
  return name;
}

/** Title = the row of tallest uppercase words (cards print the title far larger than body text). */
export function findPageTitle(words: OcrWordBox[]): string | null {
  const capsWords = words.filter((word) => {
    const letters = word.text.replace(/[^A-Za-z]/g, '');
    return letters.length >= 3 && letters === letters.toUpperCase();
  });
  if (capsWords.length < 2) return null;
  const bodyHeight = median(words.map(height));
  const rows = groupRows(capsWords, Math.max(4, bodyHeight * 0.6));
  let best: { row: Row; h: number } | null = null;
  for (const row of rows) {
    if (row.words.length < 2) continue;
    const h = median(row.words.map(height));
    if (!best || h > best.h) best = { row, h };
  }
  if (!best || best.h < bodyHeight * 1.3) return null;
  // Same-row words of title size, split at wide gaps — a logo on the same row sits apart.
  const rowWords = words
    .filter((word) => Math.abs(yCenter(word) - best!.row.yCenter) <= best!.h * 0.6 && height(word) >= best!.h * 0.5)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const clusters: OcrWordBox[][] = [];
  for (const word of rowWords) {
    const current = clusters[clusters.length - 1];
    const prev = current?.[current.length - 1];
    if (current && prev && word.bbox.x0 - prev.bbox.x1 <= best.h * 1.5) current.push(word);
    else clusters.push([word]);
  }
  const titleWords = clusters.reduce((longest, cluster) =>
    rowText(cluster).length > rowText(longest).length ? cluster : longest, clusters[0] ?? []);
  const text = rowText(titleWords);
  return text.length >= 4 ? text : null;
}

export function reconstructRecipePageLayout(words: OcrWordBox[]): RecipePageLayout | null {
  const clean = words.filter((word) => word.text.trim());
  if (clean.length === 0) return null;
  const title = findPageTitle(clean);
  const bodyHeight = median(clean.map(height)) || 16;
  const tolerance = bodyHeight * 0.6;

  const anchor = clean.find((word) => INGREDIENTS_HEADER.test(word.text.trim()));
  if (!anchor) return title ? { title, servings: [], ingredients: [] } : null;
  const headerRow = clean.filter((word) => Math.abs(yCenter(word) - yCenter(anchor)) <= tolerance);

  // Serving columns: "<n> SERVINGS" pairs left of the anchor, in x order.
  const servingColumns: Array<{ servings: number; x0: number }> = [];
  const sortedHeader = [...headerRow].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  for (let index = 1; index < sortedHeader.length; index += 1) {
    const word = sortedHeader[index]!;
    const prev = sortedHeader[index - 1]!;
    if (word.bbox.x1 > anchor.bbox.x0 || !SERVINGS_WORD.test(word.text.trim())) continue;
    const count = Number(prev.text.replace(/[^0-9]/g, ''));
    if (Number.isFinite(count) && count > 0 && count <= 24) servingColumns.push({ servings: count, x0: prev.bbox.x0 });
  }
  const columnGap = servingColumns.length >= 2 ? servingColumns[1]!.x0 - servingColumns[0]!.x0 : anchor.bbox.x0 / 2;
  const tableLeft = servingColumns.length > 0 ? servingColumns[0]!.x0 - columnGap * 0.25 : anchor.bbox.x0 - bodyHeight;
  // Next column heading to the right ("What you'll need") — may sit slightly above/below the anchor.
  const rightNeighbor = clean
    .filter((word) => word.bbox.x0 > anchor.bbox.x1 + bodyHeight && Math.abs(yCenter(word) - yCenter(anchor)) <= bodyHeight * 1.5)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0)[0];
  const tableRight = rightNeighbor ? rightNeighbor.bbox.x0 - bodyHeight * 0.5 : Number.POSITIVE_INFINITY;
  const nameLeft = anchor.bbox.x0 - bodyHeight * 0.75;

  const below = clean.filter((word) =>
    word.bbox.y0 > anchor.bbox.y1 - tolerance * 0.5
    && word.bbox.x0 >= tableLeft
    && word.bbox.x0 < tableRight
    && !headerRow.includes(word));
  const rows = groupRows(below, tolerance);

  const ingredients: RecipeIngredientRow[] = [];
  const pitches: number[] = [];
  let lastY = yCenter(anchor);
  for (const row of rows) {
    const gap = row.yCenter - lastY;
    const typicalPitch = pitches.length > 0 ? median(pitches) : bodyHeight * 2.4;
    if (gap > typicalPitch * 2.2) break;
    const nameWords = row.words.filter((word) => word.bbox.x0 >= nameLeft);
    const qtyWords = row.words.filter((word) => word.bbox.x0 < nameLeft);
    if (nameWords.length === 0 && qtyWords.length === 0) continue;
    pitches.push(gap);
    lastY = row.yCenter;

    const quantities = servingColumns.length > 0
      ? servingColumns.map((column, columnIndex) => {
          const next = servingColumns[columnIndex + 1];
          const right = next ? next.x0 - columnGap * 0.15 : nameLeft;
          const left = columnIndex === 0 ? tableLeft : column.x0 - columnGap * 0.15;
          return rowText(qtyWords.filter((word) => word.bbox.x0 >= left && word.bbox.x0 < right));
        })
      : [rowText(qtyWords)];
    const name = rowText(nameWords);
    const hasQty = quantities.some((value) => value.length > 0);
    const previous = ingredients[ingredients.length - 1];
    const continues = previous && (!hasQty || /^&/.test(name) || quantities.some((value) => /^&/.test(value)));
    if (continues) {
      if (name) previous.name = `${previous.name} ${name}`.trim();
      quantities.forEach((value, index) => {
        if (value) previous.quantities[index] = `${previous.quantities[index] ?? ''} ${value}`.trim();
      });
      continue;
    }
    if (!name) continue;
    ingredients.push({ quantities, name });
  }

  for (const row of ingredients) row.name = stripAllergenMarker(row.name);
  return {
    title,
    servings: servingColumns.map((column) => column.servings),
    ingredients: ingredients.filter((row) => /[A-Za-z]{2}/.test(row.name)),
  };
}
