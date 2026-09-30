export function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
  text = extractJsonLdNutrition(html) ?? text;
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function extractJsonLdNutrition(html: string): string | null {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!blocks) return null;
  const lines: string[] = [];
  for (const block of blocks) {
    const inner = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/, '').trim();
    try {
      collectNutritionJson(JSON.parse(inner), lines);
    } catch {
      continue;
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

function collectNutritionJson(value: unknown, lines: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectNutritionJson(item, lines));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record.nutrition || record.NutritionInformation) {
    collectNutritionJson(record.nutrition ?? record.NutritionInformation, lines);
  }
  const calories = readJsonNumber(record, ['calories', 'calorieContent']);
  if (calories != null) lines.push(`Calories ${calories}`);
  const protein = readJsonNumber(record, ['proteinContent']);
  if (protein != null) lines.push(`Protein ${protein}g`);
  const fat = readJsonNumber(record, ['fatContent']);
  if (fat != null) lines.push(`Total Fat ${fat}g`);
  const carbs = readJsonNumber(record, ['carbohydrateContent']);
  if (carbs != null) lines.push(`Total Carbohydrate ${carbs}g`);
  const fiber = readJsonNumber(record, ['fiberContent']);
  if (fiber != null) lines.push(`Dietary Fiber ${fiber}g`);
  const sodium = readJsonNumber(record, ['sodiumContent']);
  if (sodium != null) lines.push(`Sodium ${sodium}mg`);
  for (const child of Object.values(record)) collectNutritionJson(child, lines);
}

function readJsonNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      const match = raw.match(/(\d+(?:\.\d+)?)/);
      if (match) return Number(match[1]);
    }
  }
  return null;
}
