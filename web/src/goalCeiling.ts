import type { Targets } from './types';

export type CeilingStatus = 'ok' | 'near' | 'over';

/** Share of limit at which we show a “close to ceiling” warning. */
export const CEILING_NEAR_RATIO = 0.9;

export function ceilingStatus(amount: number, target: number, isCeiling: boolean): CeilingStatus {
  if (!isCeiling || target <= 0) return 'ok';
  if (amount > target) return 'over';
  if (amount >= target * CEILING_NEAR_RATIO) return 'near';
  return 'ok';
}

export function nutrientIsCeiling(key: string, targets: Targets): boolean {
  if (key === 'calories') return targets.calories > 0;
  if (key === 'carbs') return targets.carbs > 0 && targets.carbsIsLimit;
  if (key === 'sodium') return targets.sodium !== null && targets.sodium > 0 && targets.sodiumIsLimit;
  return false;
}
