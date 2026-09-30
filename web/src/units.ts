export type Units = 'metric' | 'imperial';

const ML_PER_FL_OZ = 29.5735;

export function formatVolume(ml: number, units: Units): string {
  if (units === 'imperial') {
    const oz = ml / ML_PER_FL_OZ;
    return oz >= 32 ? `${(oz / 32).toFixed(1)} qt` : `${Math.round(oz)} oz`;
  }
  return ml >= 1000 ? `${(ml / 1000).toFixed(1)} L` : `${Math.round(ml)} ml`;
}

export function hydrationTargetLabel(units: Units): string {
  return units === 'imperial' ? 'Daily hydration goal (ml)' : 'Daily hydration goal (ml)';
}

export function glassLabel(units: Units): string {
  return units === 'imperial' ? 'Add 8 oz' : 'Add glass';
}

export function removeGlassLabel(units: Units): string {
  return units === 'imperial' ? 'Remove 8 oz' : 'Remove glass';
}
