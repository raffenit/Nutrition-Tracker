export type Units = 'metric' | 'imperial';

const ML_PER_FL_OZ = 29.5735;

export function parseUnits(value: unknown): Units {
  return value === 'metric' ? 'metric' : 'imperial';
}

export function glassVolumeMl(units: Units): number {
  return units === 'imperial' ? Math.round(8 * ML_PER_FL_OZ) : 250;
}

export function mlToFlOz(ml: number): number {
  return ml / ML_PER_FL_OZ;
}
