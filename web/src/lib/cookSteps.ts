/**
 * Parses a recipe's free-text instructions into numbered steps with
 * optional lettered sub-steps for the cook dialog.
 *
 * Imported recipes store one instruction per line (JSON-LD
 * recipeInstructions arrays are joined with "\n"), so each plain
 * line becomes a step. Explicit numbering ("1.", "Step 2:", "(3)"),
 * bullets, lettered subs ("a)", "(b)."), and indented lines are
 * also handled; a single markerless blob falls back to sentence
 * splitting.
 */

export type CookStep = {
  text: string;
  subs: string[];
};

const TOP_NUMBER = /^\s*(?:step\s*)?\(?\d{1,3}\)?\s*[.):：]\s*/i;
const TOP_BULLET = /^\s*[-*•▪◦–—]\s*/;
const SUB_LETTER = /^\s*\(?[a-z]\)?\s*[.):：]\s*/i;
const SUB_BULLET = /^\s+[-*•▪◦–—]\s*/;
const BULLET_ANY = /^[-*•▪◦–—]\s*/;
const INDENTED = /^\s{2,}\S|^\t\S/;

function stripTopMarker(line: string): string {
  return line.replace(TOP_NUMBER, '').replace(TOP_BULLET, '').trim();
}

function stripSubMarker(line: string): string {
  return line.replace(SUB_LETTER, '').replace(BULLET_ANY, '').trim();
}

function isTopStep(line: string, raw: string): boolean {
  if (INDENTED.test(raw)) return false;
  return TOP_NUMBER.test(line) || TOP_BULLET.test(line);
}

function isSubStep(line: string, raw: string): boolean {
  if (SUB_LETTER.test(line)) return true;
  return SUB_BULLET.test(raw) || (INDENTED.test(raw) && !TOP_NUMBER.test(line) && !TOP_BULLET.test(line));
}

/** Split a markerless blob into sentences without breaking on "350°F." style tokens. */
function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[a-z)\]"'])\.\s+(?=[A-Z0-9("'])|(?<=[a-z)\]"'])[!?]\s+/g);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function parseCookSteps(instructions: string): CookStep[] {
  const text = instructions.trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const steps: CookStep[] = [];
  let current: CookStep | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isTopStep(line, raw)) {
      current = { text: stripTopMarker(line), subs: [] };
      steps.push(current);
      continue;
    }

    if (current && isSubStep(line, raw)) {
      current.subs.push(stripSubMarker(line));
      continue;
    }

    // Any other line starts a new step — imported recipes store one
    // instruction per line. Indented lines continue the previous
    // step (or its last sub-step) as wrapped text.
    if (current && INDENTED.test(raw)) {
      if (current.subs.length > 0) {
        current.subs[current.subs.length - 1] += ` ${line}`;
      } else {
        current.text += ` ${line}`;
      }
      continue;
    }

    current = { text: line, subs: [] };
    steps.push(current);
  }

  if (steps.length === 0) return [];

  // A single markerless blob: break it into sentences so it still numbers nicely.
  if (steps.length === 1 && steps[0].subs.length === 0) {
    const sentences = splitSentences(steps[0].text);
    if (sentences.length > 1) {
      return sentences.map((sentence) => ({ text: sentence, subs: [] }));
    }
  }

  return steps.filter((step) => step.text || step.subs.length > 0);
}
