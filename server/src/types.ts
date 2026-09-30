export type Role = 'admin' | 'member';

export type MealSlot = 'meal' | 'snack' | 'dessert' | 'drink';

export type FoodKind = 'packaged' | 'ingredient' | 'restaurant' | 'custom';

export type FoodSource = 'manual' | 'image' | 'pdf' | 'api' | 'composed';

export type ExtraNutrient = {
  key: string;
  label: string;
  amount: number;
  unit: string;
};

export type Nutrients = {
  calories: number;
  protein: number;
  fiber: number;
  fat: number;
  carbs: number;
  sodium: number;
  extras: ExtraNutrient[];
};

export type MacroShares = {
  protein: number;
  fat: number;
  carbs: number;
};

export type Units = 'metric' | 'imperial';

export type Targets = {
  calories: number;
  protein: number;
  fiber: number;
  fat: number;
  carbs: number;
  sodium: number | null;
  hydrationMl: number;
  units: Units;
  extras: ExtraNutrient[];
};

export type UserPublic = {
  id: string;
  name: string;
  role: Role;
};

export type Food = {
  id: string;
  name: string;
  brand: string | null;
  kind: FoodKind;
  servingLabel: string;
  nutrients: Nutrients;
  isFavorite: boolean;
  isDrink: boolean;
  drinkMl: number | null;
  makesServings: number;
  source: FoodSource;
  sourceRef: string | null;
  ingredients: IngredientLine[];
};

export type IngredientLine = {
  name: string;
  servings: number;
  sourceRef: string | null;
  childFoodId: string | null;
};

export type MealLog = {
  id: string;
  name: string;
  slot: MealSlot;
  eatenAt: string;
  timeLabel: string;
  servings: number;
  nutrients: Nutrients;
  drinkMl: number | null;
};

export type HydrationEntry = {
  id: string;
  amountMl: number;
  source: 'water' | 'drink';
  timeLabel: string;
  mealLogId: string | null;
};

export type DayTotals = Nutrients & {
  hydrationMl: number;
  shares: MacroShares;
};

export type SearchHit = {
  name: string;
  brand: string | null;
  servingLabel: string;
  nutrients: Nutrients;
  source: 'library' | 'usda' | 'openfoodfacts';
  sourceRef: string | null;
  foodId: string | null;
};
