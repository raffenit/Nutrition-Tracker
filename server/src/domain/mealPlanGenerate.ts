import type { Food, MealSlot } from '../types.js';
import type { ComponentRole, ProteinTag } from './proteinTags.js';

/**
 * Meal-plan shuffle generation. Builds a pool of plannable "parts" from the
 * food library — whole foods/recipes plus recipe ingredient lines tagged with
 * a component role (main vs side) — then deals them into meals pseudo-randomly.
 *
 * A meal-kit recipe contributes its tagged lines as separate candidates, so a
 * generated meal can pair a main from one kit with a side from another. The
 * result is expressed as ordinary plan entries (one foodId each); pairing is
 * implicit in sharing localDate + slot.
 */

export type PlanCandidate = {
  foodId: string;
  name: string;
  role: ComponentRole;
  proteinTags: ProteinTag[];
  /** Recipe the component line came from, when it is a recipe part. */
  sourceRecipeId: string | null;
  /** Default plan servings for this candidate. */
  servings: number;
};

export type GeneratedMeal = {
  localDate: string;
  slot: MealSlot;
  main: PlanCandidate;
  side: PlanCandidate | null;
};

export type GenerateMealPlanOptions = {
  /** Number of meals to generate. */
  mealCount: number;
  /** Any-of protein filter; empty means no filter. */
  proteins: ProteinTag[];
  /** Local dates to fill, in order (one meal per date, extra dates unused). */
  dates: string[];
  slot: MealSlot;
  /** RNG seed — same seed reproduces the same plan; bump to re-roll. */
  seed: number;
  /** Food ids to exclude from both pools (used when re-rolling a single meal). */
  avoidFoodIds?: string[];
};

export type MealPlanGenerateResult = {
  meals: GeneratedMeal[];
  /** Candidates excluded because no protein-tagged main was available. */
  proteinFilterApplied: boolean;
};

/** Deterministic PRNG (mulberry32) so plans are reproducible and re-rollable. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function candidateTags(food: Food, fallback: ProteinTag[]): ProteinTag[] {
  return food.proteinTags.length > 0 ? (food.proteinTags as ProteinTag[]) : fallback;
}

/**
 * Build the plannable pool. Recipes contribute each role-tagged ingredient
 * line whose childFoodId resolves; untagged lines are pantry staples and are
 * not independently plannable. Foods/recipes with no tagged lines become
 * whole-meal 'main' candidates.
 */
export function planCandidatesFromFoods(foods: Food[]): { mains: PlanCandidate[]; sides: PlanCandidate[] } {
  const byId = new Map(foods.map((food) => [food.id, food]));
  const mains = new Map<string, PlanCandidate>();
  const sides = new Map<string, PlanCandidate>();
  const push = (map: Map<string, PlanCandidate>, candidate: PlanCandidate) => {
    const key = `${candidate.role}:${candidate.foodId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, candidate);
      return;
    }
    // Same child food reached as a whole food and via kit lines: union tags and
    // prefer the recipe-sourced candidate (keeps kit provenance + line servings).
    const merged = new Set<ProteinTag>([...existing.proteinTags, ...candidate.proteinTags]);
    const preferred = existing.sourceRecipeId === null && candidate.sourceRecipeId !== null ? candidate : existing;
    map.set(key, { ...preferred, proteinTags: [...merged] });
  };

  for (const food of foods) {
    const taggedLines = food.ingredients.filter((line) => line.componentRole && line.childFoodId);
    if (taggedLines.length === 0) {
      push(mains, {
        foodId: food.id,
        name: food.name,
        role: 'main',
        proteinTags: food.proteinTags as ProteinTag[],
        sourceRecipeId: null,
        // Recipes default to cooking the whole batch ("Makes N"); single foods stay at 1.
        servings: food.kind === 'custom' ? Math.max(1, food.makesServings) : 1,
      });
      continue;
    }
    for (const line of taggedLines) {
      const child = byId.get(line.childFoodId!);
      if (!child) continue;
      push(line.componentRole === 'side' ? sides : mains, {
        foodId: child.id,
        name: child.name,
        role: line.componentRole!,
        proteinTags: candidateTags(child, food.proteinTags as ProteinTag[]),
        sourceRecipeId: food.id,
        servings: line.servings > 0 ? line.servings : 1,
      });
    }
  }
  return { mains: [...mains.values()], sides: [...sides.values()] };
}

function matchesProteins(candidate: PlanCandidate, proteins: ProteinTag[]): boolean {
  if (proteins.length === 0) return true;
  return candidate.proteinTags.some((tag) => proteins.includes(tag));
}

/** Shuffled candidate deck; `pickUnused` deals without repeats until exhausted. */
function dealOrder(candidates: PlanCandidate[], rand: () => number): PlanCandidate[] {
  return shuffled(candidates, rand);
}

export function generateMealPlan(foods: Food[], options: GenerateMealPlanOptions): MealPlanGenerateResult {
  const { mains, sides } = planCandidatesFromFoods(foods);
  const avoid = new Set(options.avoidFoodIds ?? []);
  const mainsPool = mains.filter((candidate) => matchesProteins(candidate, options.proteins) && !avoid.has(candidate.foodId));
  const sidesPool = sides.filter((candidate) => !avoid.has(candidate.foodId));
  const proteinFilterApplied = options.proteins.length > 0 && mainsPool.length < mains.length;
  const rand = mulberry32(options.seed);

  if (mainsPool.length === 0 || options.dates.length === 0 || options.mealCount <= 0) {
    return { meals: [], proteinFilterApplied };
  }

  const mainDeck = dealOrder(mainsPool, rand);
  const sideDeck = dealOrder(sidesPool, rand);
  const usedMains = new Set<string>();
  const usedSides = new Set<string>();

  const pickUnused = (deck: PlanCandidate[], used: Set<string>): PlanCandidate | null => {
    const fresh = deck.find((candidate) => !used.has(candidate.foodId));
    // Deck exhausted: fall back to a random pick so long plans still vary.
    const pick = fresh ?? deck[Math.floor(rand() * deck.length)];
    if (!pick) return null;
    used.add(pick.foodId);
    return pick;
  };

  const meals: GeneratedMeal[] = [];
  for (let i = 0; i < options.mealCount && i < options.dates.length; i += 1) {
    const main = pickUnused(mainDeck, usedMains);
    if (!main) break;
    const side = pickUnused(sideDeck, usedSides);
    // Don't pair a side that is the same food as the main.
    const usableSide = side && side.foodId !== main.foodId ? side : null;
    meals.push({ localDate: options.dates[i]!, slot: options.slot, main, side: usableSide });
  }
  return { meals, proteinFilterApplied };
}
