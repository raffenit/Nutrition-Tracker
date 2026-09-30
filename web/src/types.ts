export type Nutrients = {
  calories: number;
  protein: number;
  fiber: number;
  fat: number;
  carbs: number;
  sodium: number;
  extras: Array<{ key: string; label: string; amount: number; unit: string }>;
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
  extras: Nutrients['extras'];
};

export type User = { id: string; name: string; role: 'admin' | 'member' };

export type MealLog = {
  id: string;
  name: string;
  slot: 'meal' | 'snack' | 'dessert' | 'drink';
  timeLabel: string;
  servings: number;
  nutrients: Nutrients;
  drinkMl: number | null;
};

export type Food = {
  id: string;
  name: string;
  brand: string | null;
  kind: string;
  servingLabel: string;
  nutrients: Nutrients;
  isFavorite: boolean;
  isDrink: boolean;
  drinkMl: number | null;
  makesServings: number;
  source: string;
  sourceRef: string | null;
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

export type DayTotals = Nutrients & {
  hydrationMl: number;
  shares: { protein: number; fat: number; carbs: number };
};

export type WeightStatus =
  | { enabled: false }
  | {
      enabled: true;
      weekday: number;
      unit: 'lb' | 'kg';
      reminderDue: boolean;
      entries: Array<{ id: string; localDate: string; weight: number; unit: 'lb' | 'kg' }>;
    };

export type Session = {
  setupRequired: boolean;
  mode: 'user' | 'kiosk' | 'none';
  user: User | null;
  household: { name: string; timezone: string } | null;
};

export const EMPTY_NUTRIENTS: Nutrients = {
  calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0, sodium: 0, extras: [],
};
