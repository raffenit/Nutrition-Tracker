const LEADING_QTY_UNIT =
  /^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|cloves?|cans?|bunches?|heads?|packages?|pkgs?)\.?\s+(.+)$/i;

export function kitLineKeyFromText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const match = trimmed.match(LEADING_QTY_UNIT);
  const core = match?.[3]?.trim() ?? trimmed;
  return core
    .toLowerCase()
    .replace(/[''"]/g, '')
    .replace(/[^\p{L}\p{N}&\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
