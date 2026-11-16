/**
 * Curved-rule dewarp for Nutrition Facts panels photographed on cylinders (tubs, bottles).
 * Row rules are traced across vertical slabs, fitted as quadratics, and the image is remapped
 * column-by-column so each rule becomes a straight horizontal line. Pure functions over 8-bit grey.
 */

export type GreyImage = { data: Uint8Array | Buffer; width: number; height: number };

export type CurvedRule = {
  /** y = a + b·x + c·x² in image pixels. */
  a: number;
  b: number;
  c: number;
  /** Number of slabs that observed this rule. */
  support: number;
};

export type CurvedRuleDetectParams = {
  slabs: number;
  /** Fraction of the width (left/right) excluded from tracing — usually background at the curve edges. */
  xStartFraction: number;
  xEndFraction: number;
  /** Pixels darker than this count as rule ink. */
  darkThreshold: number;
  /** Minimum dark fraction of a slab row for it to be a rule row. */
  minRuleFraction: number;
  /** Rule rows thicker than this are text or filled bars, not rules. */
  maxRuleThicknessPx: number;
  /** Max vertical step between neighbouring slab observations of one rule. */
  maxLinkStepPx: number;
  /** Minimum fraction of slabs that must observe a rule. */
  minSupportFraction: number;
};

export const DEFAULT_CURVED_RULE_PARAMS: CurvedRuleDetectParams = {
  slabs: 8,
  xStartFraction: 0.12,
  xEndFraction: 0.98,
  darkThreshold: 110,
  minRuleFraction: 0.55,
  maxRuleThicknessPx: 14,
  maxLinkStepPx: 14,
  minSupportFraction: 0.5,
};

export function curvedRuleY(rule: CurvedRule, x: number): number {
  return rule.a + rule.b * x + rule.c * x * x;
}

/** Least-squares quadratic through points; falls back to a line or constant for few points. */
export function fitQuadratic(points: Array<[number, number]>): Pick<CurvedRule, 'a' | 'b' | 'c'> {
  if (points.length === 0) return { a: 0, b: 0, c: 0 };
  if (points.length === 1) return { a: points[0]![1], b: 0, c: 0 };
  if (points.length === 2) {
    const [[x0, y0], [x1, y1]] = points as [[number, number], [number, number]];
    const b = x1 === x0 ? 0 : (y1 - y0) / (x1 - x0);
    return { a: y0 - b * x0, b, c: 0 };
  }
  const s = [0, 0, 0, 0, 0];
  const t = [0, 0, 0];
  for (const [x, y] of points) {
    let p = 1;
    for (let k = 0; k < 5; k += 1) {
      s[k]! += p;
      if (k < 3) t[k]! += p * y;
      p *= x;
    }
  }
  const m = [
    [s[0]!, s[1]!, s[2]!, t[0]!],
    [s[1]!, s[2]!, s[3]!, t[1]!],
    [s[2]!, s[3]!, s[4]!, t[2]!],
  ];
  for (let i = 0; i < 3; i += 1) {
    const pivot = m[i]![i]!;
    if (Math.abs(pivot) < 1e-12) return fitQuadratic(points.slice(0, 2));
    for (let j = i; j < 4; j += 1) m[i]![j]! /= pivot;
    for (let r = 0; r < 3; r += 1) {
      if (r === i) continue;
      const f = m[r]![i]!;
      for (let j = i; j < 4; j += 1) m[r]![j]! -= f * m[i]![j]!;
    }
  }
  return { a: m[0]![3]!, b: m[1]![3]!, c: m[2]![3]! };
}

/** Thin, mostly-dark row runs per slab (rule centre y values). */
function slabRuleYs(image: GreyImage, left: number, right: number, params: CurvedRuleDetectParams): number[] {
  const { data, width, height } = image;
  const span = Math.max(1, right - left);
  const ys: number[] = [];
  let start = -1;
  for (let y = 0; y <= height; y += 1) {
    let on = false;
    if (y < height) {
      let dark = 0;
      const row = y * width;
      for (let x = left; x < right; x += 1) if (data[row + x]! < params.darkThreshold) dark += 1;
      on = dark / span > params.minRuleFraction;
    }
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      if (y - start <= params.maxRuleThicknessPx) ys.push((start + y - 1) / 2);
      start = -1;
    }
  }
  return ys;
}

/** Trace row rules across slabs and fit each as a quadratic; sorted top to bottom at the centre. */
export function detectCurvedRules(
  image: GreyImage,
  params: CurvedRuleDetectParams = DEFAULT_CURVED_RULE_PARAMS,
): CurvedRule[] {
  const xa = Math.round(image.width * params.xStartFraction);
  const xb = Math.round(image.width * params.xEndFraction);
  const slabWidth = (xb - xa) / params.slabs;
  if (slabWidth < 8) return [];

  type Obs = { slab: number; x: number; y: number };
  const chains: Obs[][] = [];
  for (let slab = 0; slab < params.slabs; slab += 1) {
    const left = Math.round(xa + slab * slabWidth);
    const right = Math.round(xa + (slab + 1) * slabWidth);
    const cx = (left + right) / 2;
    for (const y of slabRuleYs(image, left, right, params)) {
      let best: Obs[] | null = null;
      let bestDist = Infinity;
      for (const chain of chains) {
        const last = chain[chain.length - 1]!;
        if (last.slab >= slab || slab - last.slab > 2) continue;
        const dist = Math.abs(last.y - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = chain;
        }
      }
      const obs = { slab, x: cx, y };
      if (best && bestDist <= params.maxLinkStepPx) best.push(obs);
      else chains.push([obs]);
    }
  }

  const minSupport = Math.max(3, Math.ceil(params.slabs * params.minSupportFraction));
  const cx = image.width / 2;
  return chains
    .filter((chain) => chain.length >= minSupport)
    .map((chain) => ({ ...fitQuadratic(chain.map((o) => [o.x, o.y])), support: chain.length }))
    .sort((p, q) => curvedRuleY(p, cx) - curvedRuleY(q, cx));
}

/** Largest vertical departure of any rule from a straight line between its ends (curvature, not tilt). */
export function maxRuleBendPx(rules: CurvedRule[], width: number): number {
  let max = 0;
  for (const rule of rules) {
    const y0 = curvedRuleY(rule, 0);
    const y1 = curvedRuleY(rule, width - 1);
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 32))) {
      const chord = y0 + ((y1 - y0) * x) / Math.max(1, width - 1);
      max = Math.max(max, Math.abs(curvedRuleY(rule, x) - chord));
    }
  }
  return max;
}

/** Largest vertical spread of any rule across the width (bend plus tilt). */
export function maxRuleSpreadPx(rules: CurvedRule[], width: number): number {
  let max = 0;
  for (const rule of rules) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 32))) {
      const y = curvedRuleY(rule, x);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    max = Math.max(max, hi - lo);
  }
  return max;
}

/**
 * Remap so each rule lies on its centre-column y. Between rules the source y is interpolated
 * linearly; above the first / below the last rule the nearest rule's offset is reused.
 */
export function dewarpToStraightRules(image: GreyImage, rules: CurvedRule[]): Buffer {
  const { data, width, height } = image;
  const out = Buffer.alloc(width * height, 255);
  if (rules.length === 0) {
    out.set(data);
    return out;
  }
  const cx = width / 2;
  const refs = rules.map((rule) => curvedRuleY(rule, cx));
  const srcYs = new Array<number>(rules.length);
  for (let x = 0; x < width; x += 1) {
    for (let i = 0; i < rules.length; i += 1) srcYs[i] = curvedRuleY(rules[i]!, x);
    let i = 0;
    for (let y = 0; y < height; y += 1) {
      while (i < refs.length && refs[i]! < y) i += 1;
      let sy: number;
      if (i === 0) sy = y + (srcYs[0]! - refs[0]!);
      else if (i === refs.length) sy = y + (srcYs[i - 1]! - refs[i - 1]!);
      else {
        const t = (y - refs[i - 1]!) / Math.max(1e-6, refs[i]! - refs[i - 1]!);
        sy = srcYs[i - 1]! + t * (srcYs[i]! - srcYs[i - 1]!);
      }
      const y0 = Math.floor(sy);
      if (y0 < 0 || y0 + 1 >= height) continue;
      const f = sy - y0;
      out[y * width + x] = Math.round(data[y0 * width + x]! * (1 - f) + data[(y0 + 1) * width + x]! * f);
    }
  }
  return out;
}
